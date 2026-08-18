/**
 * Email AI analysis — the text-preparation helpers, the taxonomy snapping, the
 * prompt contract, and the worker state machine.
 *
 * Gemini is never called: `fetch` is stubbed, so these tests assert what we send
 * and how we treat what comes back.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
process.env.GEMINI_MIN_INTERVAL_MS = '0';   // no rate-limit sleeping in tests

// The schema is a frozen constant — safe to read once at collection time.
const { CATEGORIZATION_SCHEMA } = require('../src/services/geminiService');

/**
 * A 429 puts a module-level cooldown on that model, on purpose: a rate limit
 * hit by one job must pause every other job too. That state would otherwise
 * leak into the next test and make it wait the cooldown out, so each test gets
 * a freshly-required module.
 */
let svc;
beforeEach(() => {
  jest.resetModules();
  svc = require('../src/services/geminiService');
});

/** A realistic candidate email, as stored by the sync worker. */
const EMAIL = {
  gmail_id:    'm1',
  subject:     'Fee debited twice',
  from_name:   'Km Aasha',
  from_email:  'aasha@example.com',
  received_at: new Date('2026-08-17T10:00:00Z'),
  body_text:   'Sir mera fee do baar cut gaya hai lekin form submit nahi hua. Please ek payment refund kar dijiye. Transaction ref 4471xx.',
  body_html:   '',
  attachments: [],
};

/** Gemini's happy-path JSON for that email. */
const GOOD_RESPONSE = {
  category:         'Payment & Fee',
  sub_category:     'Duplicate Payment Refund Query',
  summary:          'The fee was debited twice. They ask for one payment to be refunded.',
  ai_insight:       'Duplicate payment refund request',
  bugs:             '-',
  bug_category:     '-',
  requested_action: 'Refund',
  language:         ['Hinglish'],
  error:            null,
};

/** Stub fetch as the Gemini generateContent endpoint. */
function stubGemini(bodyOrFn, { status = 200 } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    const payload = typeof bodyOrFn === 'function' ? bodyOrFn(calls.length) : bodyOrFn;
    if (payload?.__http) {
      return {
        ok: false, status: payload.__http,
        headers: { get: () => null },
        text: async () => payload.__text || 'error',
        json: async () => ({}),
      };
    }
    return {
      ok: status < 400, status,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
    };
  });
  return calls;
}

afterEach(() => { delete global.fetch; });

// ─── Text preparation ─────────────────────────────────────────────────────────

describe('stripQuotedText', () => {
  it('drops a Gmail-style quoted reply', () => {
    const body = 'Mera OTR nahi khul raha\n\nOn Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> earlier reply\n> more quoted';
    expect(svc.stripQuotedText(body)).toBe('Mera OTR nahi khul raha');
  });

  it('drops an Outlook original-message block', () => {
    const body = 'Please correct my name.\n\n-----Original Message-----\nFrom: support\nOld text';
    expect(svc.stripQuotedText(body)).toBe('Please correct my name.');
  });

  it('keeps the quoted text when the candidate wrote nothing above it', () => {
    // A bare forward IS the content — cutting would leave an empty body and the
    // email would be misfiled as "Email too Short".
    const body = 'On Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> my registration failed';
    expect(svc.stripQuotedText(body)).toContain('registration failed');
  });

  it('leaves an ordinary email untouched', () => {
    expect(svc.stripQuotedText('Simple request about my marksheet')).toBe('Simple request about my marksheet');
  });

  it('handles empty input', () => {
    expect(svc.stripQuotedText('')).toBe('');
    expect(svc.stripQuotedText(undefined)).toBe('');
  });
});

describe('htmlToText', () => {
  it('converts block tags to line breaks and strips markup', () => {
    expect(svc.htmlToText('<p>Payment <b>debited</b></p><div>form incomplete</div>')).toMatch(/Payment debited/);
    expect(svc.htmlToText('<p>a</p><p>b</p>')).toContain('\n');
  });

  it('removes script and style content entirely', () => {
    const out = svc.htmlToText('<style>.x{color:red}</style><script>alert(1)</script><p>real text</p>');
    expect(out).not.toMatch(/color:red|alert/);
    expect(out).toContain('real text');
  });

  it('decodes the common entities', () => {
    expect(svc.htmlToText('<p>B.Ed &amp; D.El.Ed &lt;2026&gt; &quot;x&quot; &#39;y&#39;&nbsp;z</p>'))
      .toBe('B.Ed & D.El.Ed <2026> "x" \'y\' z');
  });
});

describe('emailToPlainText', () => {
  it('prefers the plain-text part', () => {
    expect(svc.emailToPlainText({ body_text: 'plain wins', body_html: '<p>html loses</p>' })).toBe('plain wins');
  });

  it('falls back to HTML when there is no usable text part', () => {
    expect(svc.emailToPlainText({ body_text: '   ', body_html: '<p>from html</p>' })).toBe('from html');
  });

  it('returns an empty string for a body-less email', () => {
    expect(svc.emailToPlainText({})).toBe('');
  });
});

// ─── Taxonomy snapping ────────────────────────────────────────────────────────

describe('snapToTaxonomy', () => {
  const firstCategory = Object.keys(CATEGORIZATION_SCHEMA)[0];
  const firstSub = CATEGORIZATION_SCHEMA[firstCategory][0];

  it('passes a valid parent/child pair through', () => {
    expect(svc.snapToTaxonomy(firstCategory, firstSub, { dynamic: false }))
      .toEqual({ category: firstCategory, sub_category: firstSub });
  });

  it('snaps an invented category to Uncategorised', () => {
    expect(svc.snapToTaxonomy('Totally Invented', 'whatever', { dynamic: false }))
      .toEqual({ category: 'Uncategorised', sub_category: '-' });
  });

  it('snaps a sub-category borrowed from another parent to "Other"', () => {
    const otherSub = CATEGORIZATION_SCHEMA[Object.keys(CATEGORIZATION_SCHEMA)[1]][0];
    expect(svc.snapToTaxonomy(firstCategory, otherSub, { dynamic: false }))
      .toEqual({ category: firstCategory, sub_category: 'Other' });
  });

  it('accepts the wildcards "-" and "Other"', () => {
    expect(svc.snapToTaxonomy(firstCategory, 'Other', { dynamic: false }).sub_category).toBe('Other');
    expect(svc.snapToTaxonomy(firstCategory, '-', { dynamic: false }).sub_category).toBe('-');
  });

  it('strips numbering and label prefixes before matching', () => {
    expect(svc.snapToTaxonomy(`1. ${firstCategory}`, firstSub, { dynamic: false }).category).toBe(firstCategory);
    expect(svc.snapToTaxonomy(`Category: ${firstCategory}`, firstSub, { dynamic: false }).category).toBe(firstCategory);
  });

  it('validates against the live taxonomy when dynamic categories are on', () => {
    const taxonomy = [{ name: 'Live Cat', sub_categories: ['Live Sub'] }];
    expect(svc.snapToTaxonomy('Live Cat', 'Live Sub', { taxonomy, dynamic: true }))
      .toEqual({ category: 'Live Cat', sub_category: 'Live Sub' });
    // A hardcoded-schema name is NOT valid when the dynamic taxonomy is in force.
    expect(svc.snapToTaxonomy(firstCategory, firstSub, { taxonomy, dynamic: true }))
      .toEqual({ category: 'Uncategorised', sub_category: '-' });
  });

  it('preserves Uncategorised rather than trying to snap it', () => {
    expect(svc.snapToTaxonomy('Uncategorised', '-', { dynamic: false }))
      .toEqual({ category: 'Uncategorised', sub_category: '-' });
  });
});

// ─── categorizeEmail ──────────────────────────────────────────────────────────

describe('categorizeEmail — the prompt we send', () => {
  it('includes the subject, sender, date and body', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail(EMAIL, { bugCategories: ['Payment Gateway'] });

    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toContain('Fee debited twice');
    expect(prompt).toContain('aasha@example.com');
    expect(prompt).toContain('2026-08-17T10:00:00.000Z');
    expect(prompt).toContain('do baar cut gaya');
  });

  it('ships the full categorization schema', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail(EMAIL);
    const prompt = calls[0].body.contents[0].parts[0].text;
    for (const name of Object.keys(CATEGORIZATION_SCHEMA)) expect(prompt).toContain(name);
  });

  it('passes the bug category list through', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail(EMAIL, { bugCategories: ['Payment Gateway', 'eKYC'] });
    expect(calls[0].body.contents[0].parts[0].text).toContain('Payment Gateway');
  });

  it('requests JSON and sends no audio part', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail(EMAIL);
    expect(calls[0].body.generationConfig.response_mime_type).toBe('application/json');
    expect(calls[0].body.contents[0].parts).toHaveLength(1);   // text only — no file_data
  });

  it('strips the quoted thread out of the prompt', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail({
      ...EMAIL,
      body_text: 'Naya issue hai\n\nOn Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> SECRET_QUOTED_MARKER',
    });
    expect(calls[0].body.contents[0].parts[0].text).not.toContain('SECRET_QUOTED_MARKER');
  });

  it('truncates an oversized body and says so', async () => {
    process.env.EMAIL_ANALYSIS_MAX_CHARS = '600';
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail({ ...EMAIL, body_text: 'x'.repeat(20_000) });
    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toMatch(/more characters omitted/);
    expect(prompt.length).toBeLessThan(20_000);
    delete process.env.EMAIL_ANALYSIS_MAX_CHARS;
  });

  it('lists attachment filenames', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail({ ...EMAIL, attachments: [{ filename: 'marksheet.pdf' }] });
    expect(calls[0].body.contents[0].parts[0].text).toContain('marksheet.pdf');
  });

  it('does not ask for a dynamic taxonomy pair while the flag is off', async () => {
    const calls = stubGemini(GOOD_RESPONSE);
    await svc.categorizeEmail(EMAIL, { callCategories: [{ name: 'Live Cat', sub_categories: ['Live Sub'] }] });
    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).not.toContain('email_category');
    expect(prompt).not.toContain('Live Cat');
  });

  it('asks for it when DYNAMIC_CATEGORIES_ENABLED is on', async () => {
    process.env.DYNAMIC_CATEGORIES_ENABLED = 'true';
    const calls = stubGemini({ ...GOOD_RESPONSE, email_category: 'Live Cat', email_sub_category: 'Live Sub' });
    await svc.categorizeEmail(EMAIL, { callCategories: [{ name: 'Live Cat', sub_categories: ['Live Sub'] }] });
    const prompt = calls[0].body.contents[0].parts[0].text;
    expect(prompt).toContain('email_category');
    expect(prompt).toContain('Live Cat');
    delete process.env.DYNAMIC_CATEGORIES_ENABLED;
  });
});

describe('categorizeEmail — the result we return', () => {
  it('maps a clean response onto the stored shape', async () => {
    stubGemini(GOOD_RESPONSE);
    const result = await svc.categorizeEmail(EMAIL);

    expect(result).toMatchObject({
      success:            true,
      category:           'Payment & Fee',
      sub_category:       'Duplicate Payment Refund Query',
      ai_insight:         'Duplicate payment refund request',
      bugs:               '-',
      bug_category:       '-',
      requested_action:   'Refund',
      language:           ['Hinglish'],
      model_used:         'gemini-2.5-flash',
      used_fallback:      false,
    });
    expect(result.summary).toMatch(/debited twice/);
  });

  it('mirrors the pair into email_category when the taxonomy is static', async () => {
    stubGemini(GOOD_RESPONSE);
    const result = await svc.categorizeEmail(EMAIL);
    expect(result.email_category).toBe('Payment & Fee');
    expect(result.email_sub_category).toBe('Duplicate Payment Refund Query');
  });

  it('snaps an invented category instead of storing it', async () => {
    stubGemini({ ...GOOD_RESPONSE, category: 'Refund Desk', sub_category: 'Money Back' });
    const result = await svc.categorizeEmail(EMAIL);
    expect(result.category).toBe('Uncategorised');
    expect(result.sub_category).toBe('-');
  });

  it('applies the Content Unclear sentinel verbatim', async () => {
    stubGemini({
      category: 'Content Unclear', sub_category: '', summary: 'Email content insufficient for analysis.',
      ai_insight: 'anything', bugs: '-', bug_category: '-', language: [],
    });
    const result = await svc.categorizeEmail(EMAIL);
    expect(result.category).toBe('Content Unclear');
    expect(result.sub_category).toBe('');
    expect(result.ai_insight).toBe('-');            // forced, not whatever the model said
    expect(result.email_category).toBe('Uncategorised');
  });

  it('forces bug_category to "-" when no bug was reported', async () => {
    stubGemini({ ...GOOD_RESPONSE, bugs: '-', bug_category: 'Payment Gateway' });
    expect((await svc.categorizeEmail(EMAIL)).bug_category).toBe('-');
  });

  it('defaults bug_category to Uncategorised when a bug has no category', async () => {
    stubGemini({ ...GOOD_RESPONSE, bugs: 'Appearing option missing from dropdown.', bug_category: '' });
    const result = await svc.categorizeEmail(EMAIL);
    expect(result.bugs).toMatch(/Appearing option/);
    expect(result.bug_category).toBe('Uncategorised');
  });

  it('coerces a single language string into an array', async () => {
    stubGemini({ ...GOOD_RESPONSE, language: 'Hindi' });
    expect((await svc.categorizeEmail(EMAIL)).language).toEqual(['Hindi']);
  });

  it('reports a missing API key without calling out', async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const fetchMock = stubGemini(GOOD_RESPONSE);
    const result = await svc.categorizeEmail(EMAIL);
    expect(result).toEqual({ success: false, error: 'GEMINI_API_KEY not set' });
    expect(fetchMock).toHaveLength(0);
    process.env.GEMINI_API_KEY = saved;
  });
});

describe('categorizeEmail — failure handling', () => {
  it('falls back to the secondary model on 429', async () => {
    const calls = stubGemini(n => (n === 1 ? { __http: 429 } : GOOD_RESPONSE));
    const result = await svc.categorizeEmail(EMAIL);

    expect(result.success).toBe(true);
    expect(result.used_fallback).toBe(true);
    expect(result.model_used).toBe('gemini-2.5-flash-lite');
    expect(calls[0].url).toContain('gemini-2.5-flash:');
    expect(calls[1].url).toContain('gemini-2.5-flash-lite:');
  });

  it('marks a 400 permanent so the worker stops retrying', async () => {
    stubGemini({ __http: 400, __text: 'bad request' });
    const result = await svc.categorizeEmail(EMAIL, {}, 1);
    expect(result.success).toBe(false);
    expect(result.permanent).toBe(true);
  });

  it('treats a 500 as retryable, not permanent', async () => {
    stubGemini({ __http: 500, __text: 'server error' });
    const result = await svc.categorizeEmail(EMAIL, {}, 1);
    expect(result.success).toBe(false);
    expect(result.permanent).toBe(false);
  });

  it('surfaces an error field returned inside the JSON', async () => {
    stubGemini({ error: 'model refused' });
    const result = await svc.categorizeEmail(EMAIL, {}, 1);
    expect(result).toMatchObject({ success: false, error: 'model refused' });
  });

  it('recovers when the model wraps its JSON in a markdown fence', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(GOOD_RESPONSE) + '\n```' }] } }] }),
    }));
    expect((await svc.categorizeEmail(EMAIL)).category).toBe('Payment & Fee');
  });

  it('fails cleanly on unparseable output', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }),
    }));
    const result = await svc.categorizeEmail(EMAIL, {}, 1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid JSON/);
  });
});
