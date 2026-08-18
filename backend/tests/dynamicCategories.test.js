/**
 * DYNAMIC_CATEGORIES_ENABLED — the switch that decides whether call_category /
 * call_sub_category come from the Gemini-authored `call_categories` collection
 * or from the hardcoded CATEGORIZATION_SCHEMA.
 *
 * The flag has to hold on three independent surfaces, so all three are pinned
 * here: the analysis prompt (what Gemini is even asked), the post-response
 * snapping (what reaches the DB), and the two admin taxonomy endpoints.
 *
 * Every Gemini call is served by a fake fetch — a suite that reaches
 * generativelanguage.googleapis.com has failed, not passed.
 */
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY        = 'test-key';
process.env.GEMINI_MIN_INTERVAL_MS = '1';   // don't burn wall-clock on the rate gate

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));
jest.mock('../src/workers/exportWorker', () => ({
  createExportJob: jest.fn(), getExportJob: jest.fn(), streamCsv: jest.fn(),
}));

const { categorizeRecording, CATEGORIZATION_SCHEMA } = require('../src/services/geminiService');
const { dynamicCategoriesEnabled, envBool } = require('../src/config/features');

// ── Fake Gemini ──────────────────────────────────────────────────────────────
// Routes the four calls categorizeRecording makes: audio GET, resumable-upload
// init, byte upload, generateContent. `capturedPrompt` is what we assert on.
let capturedPrompt;
let geminiAnalysis;

function installFakeFetch() {
  capturedPrompt = null;
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    const ok = (body, headers = {}) => ({
      ok: true, status: 200,
      headers: { get: k => headers[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
      body: 'audio-stream',
    });

    if (u.startsWith('https://recordings.example/')) {
      return ok({}, { 'content-length': '1024', 'content-type': 'audio/x-wav' });
    }
    if (u.includes('/upload/v1beta/files')) {
      return ok({}, { 'x-goog-upload-url': 'https://upload.example/session' });
    }
    if (u.startsWith('https://upload.example/')) {
      return ok({ file: { uri: 'files/abc', name: 'files/abc' } });
    }
    if (u.includes(':generateContent')) {
      capturedPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
      return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiAnalysis) }] } }] });
    }
    if (opts.method === 'DELETE') return ok({});
    throw new Error(`fake fetch: unrouted ${u}`);
  });
}

/** A well-formed Gemini response; `over` patches the categorisation fields. */
function analysisFixture(over = {}) {
  return {
    category: 'Payment & Fee',
    sub_category: 'Fee Amount Query',
    summary: 'Candidate asked the fee. Agent quoted it.',
    ai_insight: 'Exam fee amount query',
    bugs: '-',
    bug_category: '-',
    agent_score: 8,
    call_resolved: 'Yes',
    audio_quality: { rating: 'Good', issues: '-' },
    transcription: 'CANDIDATE: fee kitni hai?\nAGENT: 600 rupaye.',
    language: ['Hindi'],
    error: null,
    ...over,
  };
}

const DYNAMIC_TAXONOMY = [
  { name: 'Payment Issues',   sub_categories: ['Fee Query', 'Refund Query'] },
  { name: 'Portal Problems',  sub_categories: ['Login Failure'] },
];

const analyse = () =>
  categorizeRecording('https://recordings.example/call.wav', { callCategories: DYNAMIC_TAXONOMY, bugCategories: [] });

beforeEach(() => {
  jest.clearAllMocks();
  geminiAnalysis = analysisFixture();
  installFakeFetch();
  delete process.env.DYNAMIC_CATEGORIES_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('flag parsing', () => {
  test('defaults to off when unset', () => {
    expect(dynamicCategoriesEnabled()).toBe(false);
  });

  test.each(['true', 'TRUE', '1', 'yes', 'on'])('%s enables it', v => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = v;
    expect(dynamicCategoriesEnabled()).toBe(true);
  });

  // A typo must not switch an opt-in feature on — that is the whole point of
  // an allowlist rather than a truthiness check.
  test.each(['false', '0', 'no', 'off', '', '   ', 'maybe', 'enabled'])('%s leaves it off', v => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = v;
    expect(dynamicCategoriesEnabled()).toBe(false);
  });

  test('envBool honours an explicit default only when unset', () => {
    delete process.env.SOME_FLAG;
    expect(envBool('SOME_FLAG', true)).toBe(true);
    process.env.SOME_FLAG = 'no';
    expect(envBool('SOME_FLAG', true)).toBe(false);
    delete process.env.SOME_FLAG;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('analysis prompt', () => {
  test('flag off — the taxonomy is never shown to Gemini', async () => {
    await analyse();
    expect(capturedPrompt).not.toContain('TAXONOMY:');
    expect(capturedPrompt).not.toContain('Payment Issues');   // no dynamic name leaks in
    expect(capturedPrompt).not.toContain('"call_category"');  // not requested in the output shape
    expect(capturedPrompt).not.toContain('"call_sub_category"');
    // The hardcoded schema is still there — this flag never touches it.
    expect(capturedPrompt).toContain('CATEGORIZATION SCHEMA:');
    expect(capturedPrompt).toContain('Fee Amount Query');
    // Bug detection keeps a sane task number with task 10 removed.
    expect(capturedPrompt).toContain('10) Bug Category:');
    expect(capturedPrompt).not.toContain('11) Bug Category:');
  });

  test('flag on — the taxonomy is restored verbatim', async () => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = 'true';
    await analyse();
    expect(capturedPrompt).toContain('TAXONOMY:');
    expect(capturedPrompt).toContain('Payment Issues');
    expect(capturedPrompt).toContain('"call_category"');
    expect(capturedPrompt).toContain('10) Call Category & Sub-Category:');
    expect(capturedPrompt).toContain('11) Bug Category:');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('call_category derivation with the flag off', () => {
  test('mirrors an on-schema pair from the hardcoded fields', async () => {
    const r = await analyse();
    expect(r.success).toBe(true);
    expect(r.call_category).toBe('Payment & Fee');
    expect(r.call_sub_category).toBe('Fee Amount Query');
  });

  // The 6% drift found in the 2026-08 audit: Gemini paraphrases the category
  // name. It must not ride into call_category on the back of the mirror.
  test('an off-schema category snaps to Uncategorised', async () => {
    geminiAnalysis = analysisFixture({
      category: 'Payment Issues',                       // invented — not a schema key
      sub_category: 'Money Debited but Application Incomplete',
    });
    const r = await analyse();
    expect(r.call_category).toBe('Uncategorised');
    expect(r.call_sub_category).toBe('-');
  });

  test('a valid parent with a foreign sub snaps the sub to Other', async () => {
    geminiAnalysis = analysisFixture({
      category: 'Payment & Fee',
      sub_category: 'Aadhaar OTP Not Received',         // real, but belongs to Identity Verification
    });
    const r = await analyse();
    expect(r.call_category).toBe('Payment & Fee');
    expect(r.call_sub_category).toBe('Other');
  });

  // Whatever Gemini volunteers is ignored — the field is not sourced from it.
  test('an unsolicited call_category in the response is discarded', async () => {
    geminiAnalysis = analysisFixture({ call_category: 'Payment Issues', call_sub_category: 'Fee Query' });
    const r = await analyse();
    expect(r.call_category).toBe('Payment & Fee');
    expect(r.call_sub_category).toBe('Fee Amount Query');
  });

  test('every derived pair is a real CATEGORIZATION_SCHEMA entry', async () => {
    const [cat] = Object.keys(CATEGORIZATION_SCHEMA);
    geminiAnalysis = analysisFixture({ category: cat, sub_category: CATEGORIZATION_SCHEMA[cat][0] });
    const r = await analyse();
    expect(CATEGORIZATION_SCHEMA[r.call_category]).toContain(r.call_sub_category);
  });
});

describe('call_category derivation with the flag on', () => {
  test('the dynamic pick is honoured', async () => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = 'true';
    geminiAnalysis = analysisFixture({ call_category: 'Payment Issues', call_sub_category: 'Refund Query' });
    const r = await analyse();
    expect(r.call_category).toBe('Payment Issues');
    expect(r.call_sub_category).toBe('Refund Query');
  });

  test('a name outside the dynamic taxonomy still snaps', async () => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = 'true';
    geminiAnalysis = analysisFixture({ call_category: 'Something Invented', call_sub_category: 'Whatever' });
    const r = await analyse();
    expect(r.call_category).toBe('Uncategorised');
    expect(r.call_sub_category).toBe('-');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('taxonomy endpoints', () => {
  const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
  const agentToken = jwt.sign({ name: 'Ravi', role: 'agent' }, 'test-secret');

  let app;
  beforeEach(() => {
    // Enough completed analyses and categories that neither endpoint can bail
    // on "not enough data" — so a 409 can only have come from the flag gate.
    const analyses = Array.from({ length: 40 }, (_, i) => ({
      _id: `a${i}`, call_id: `C-${i}`, status: 'completed',
      category: 'Payment & Fee', summary: `Distinct summary number ${i} about a fee question.`,
      created_at: new Date('2026-05-01T00:00:00Z'),
    }));
    const categories = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']
      .map((n, i) => ({ _id: `c${i}`, name: n, sub_categories: ['One', 'Two'] }));

    mockFake = createFakeDb({ call_analysis: analyses, call_categories: categories });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const t = req.headers.authorization?.split(' ')[1];
      if (t) { try { req.user = jwt.verify(t, 'test-secret'); } catch { /* leave unset */ } }
      next();
    });
    app.use('/api/analysis', require('../src/routes/analysis'));
  });

  const post = (path, token = adminToken) =>
    request(app).post(path).set('Authorization', `Bearer ${token}`).send({});

  test.each(['/api/analysis/generate-categories', '/api/analysis/generalise-categories'])(
    'POST %s is refused with 409 while the flag is off', async path => {
      const res = await post(path);
      expect(res.status).toBe(409);
      expect(res.body.flag).toBe('DYNAMIC_CATEGORIES_ENABLED');
      expect(global.fetch).not.toHaveBeenCalled();   // no Gemini spend on a refused call
    });

  // The admin check must still run first — the flag is not an auth bypass.
  test.each(['/api/analysis/generate-categories', '/api/analysis/generalise-categories'])(
    'POST %s still rejects a non-admin with 403', async path => {
      const res = await post(path, agentToken);
      expect(res.status).toBe(403);
    });

  test.each(['/api/analysis/generate-categories', '/api/analysis/generalise-categories'])(
    'POST %s passes the gate once the flag is on', async path => {
      process.env.DYNAMIC_CATEGORIES_ENABLED = 'true';
      // Gemini returns junk, so these land on 502 — the point is only that they
      // got past the 409 and reached the generator.
      geminiAnalysis = {};
      const res = await post(path);
      expect(res.status).not.toBe(409);
      expect(global.fetch).toHaveBeenCalled();
    });
});
