/**
 * Gemini cost accounting.
 *
 * The rule these tests exist to protect: an unknown cost is null, never zero.
 * A zero is a claim that something was free, and reporting spend as free is
 * the one failure mode of a cost report that nobody would catch by reading it.
 */
process.env.NODE_ENV = 'test';

const { costOf, totalCost, ratesFor, rateCard, displayCurrency, DEFAULT_RATES } =
  require('../src/config/geminiPricing');

const ENV_KEYS = ['GEMINI_PRICING', 'GEMINI_COST_CURRENCY', 'GEMINI_COST_PER_USD'];
const saved = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(()  => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const usage = (over = {}) => ({
  model: 'gemini-2.5-flash',
  prompt_tokens: 1_000_000,
  output_tokens: 1_000_000,
  ...over,
});

describe('costOf', () => {
  it('prices text input and output at their own rates', () => {
    const { usd, priced } = costOf(usage());
    const r = DEFAULT_RATES['gemini-2.5-flash'];
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(r.text + r.output, 10);
  });

  it('charges audio tokens at the audio rate, not the text rate', () => {
    const audioOnly = costOf(usage({ modalities: { AUDIO: 1_000_000 }, output_tokens: 0 }));
    const textOnly  = costOf(usage({ output_tokens: 0 }));
    const r = DEFAULT_RATES['gemini-2.5-flash'];

    expect(audioOnly.usd).toBeCloseTo(r.audio, 10);
    expect(textOnly.usd).toBeCloseTo(r.text, 10);
    // Audio is the expensive one; a call recording priced as text would
    // understate the bill several-fold.
    expect(audioOnly.usd).toBeGreaterThan(textOnly.usd);
  });

  it('splits a mixed prompt, charging only the audio part at the audio rate', () => {
    const { usd } = costOf(usage({
      prompt_tokens: 1_000_000,
      modalities: { AUDIO: 600_000, TEXT: 400_000 },
      output_tokens: 0,
    }));
    const r = DEFAULT_RATES['gemini-2.5-flash'];
    expect(usd).toBeCloseTo(0.6 * r.audio + 0.4 * r.text, 10);
  });

  it('charges the whole prompt as text when no modality split was recorded', () => {
    // Older records predate the breakdown; they stay priced rather than dropped.
    const { usd, priced } = costOf(usage({ output_tokens: 0 }));
    expect(priced).toBe(true);
    expect(usd).toBeCloseTo(DEFAULT_RATES['gemini-2.5-flash'].text, 10);
  });

  it('returns null — not zero — when no usage was recorded', () => {
    const { usd, priced } = costOf(null);
    expect(usd).toBeNull();
    expect(priced).toBe(false);
  });

  it('returns null — not zero — for a model with no rate', () => {
    const { usd, priced, reason } = costOf(usage({ model: 'gemini-9-ultra' }));
    expect(usd).toBeNull();
    expect(priced).toBe(false);
    expect(reason).toMatch(/gemini-9-ultra/);
  });

  it('never guesses a rate from a similar model name', () => {
    expect(ratesFor('gemini-2.5-flash-preview')).toBeNull();
    expect(ratesFor(undefined)).toBeNull();
  });
});

describe('totalCost', () => {
  it('sums priced analyses and counts the rest as unpriced', () => {
    const t = totalCost([usage(), null, usage({ model: 'unknown-model' })]);
    expect(t.priced).toBe(1);
    expect(t.unpriced).toBe(2);
    expect(t.usd).toBeGreaterThan(0);
  });

  it('keeps sub-cent precision, so a cheap day is not reported as free', () => {
    // 1000 tokens on flash-lite is a small fraction of a cent.
    const t = totalCost([{ model: 'gemini-2.5-flash-lite', prompt_tokens: 1000, output_tokens: 0 }]);
    expect(t.usd).toBeGreaterThan(0);
    expect(t.usd).toBeLessThan(0.01);
  });

  it('reports zero spend and zero priced for an empty window', () => {
    const t = totalCost([]);
    expect(t).toMatchObject({ usd: 0, priced: 0, unpriced: 0 });
  });

  it('totals tokens even for analyses it could not price', () => {
    const t = totalCost([usage({ model: 'unknown-model', prompt_tokens: 500, output_tokens: 100 })]);
    expect(t.unpriced).toBe(1);
    expect(t.tokens.prompt).toBe(500);
    expect(t.tokens.output).toBe(100);
  });
});

describe('rateCard overrides', () => {
  it('lets a deployment correct a rate without a code change', () => {
    process.env.GEMINI_PRICING = JSON.stringify({ 'gemini-2.5-flash': { text: 1, audio: 2, output: 3 } });
    expect(ratesFor('gemini-2.5-flash')).toEqual({ text: 1, audio: 2, output: 3 });
  });

  it('lets a deployment price a model the defaults do not know', () => {
    process.env.GEMINI_PRICING = JSON.stringify({ 'gemini-9-ultra': { text: 1, audio: 1, output: 1 } });
    expect(costOf(usage({ model: 'gemini-9-ultra', output_tokens: 0 })).priced).toBe(true);
  });

  it('keeps the defaults for models the override does not mention', () => {
    process.env.GEMINI_PRICING = JSON.stringify({ 'gemini-9-ultra': { text: 1, audio: 1, output: 1 } });
    expect(ratesFor('gemini-2.5-flash')).toEqual(DEFAULT_RATES['gemini-2.5-flash']);
  });

  it('falls back to the defaults when the override is not valid JSON', () => {
    process.env.GEMINI_PRICING = '{not json';
    expect(rateCard()).toEqual(DEFAULT_RATES);
  });

  it('ignores an override that is not an object', () => {
    process.env.GEMINI_PRICING = '[1,2,3]';
    expect(rateCard()).toEqual(DEFAULT_RATES);
  });
});

describe('displayCurrency', () => {
  it('is USD by default, because that is what Google bills', () => {
    expect(displayCurrency()).toEqual({ code: 'USD', perUsd: 1 });
  });

  it('converts only when given an explicit rate', () => {
    process.env.GEMINI_COST_CURRENCY = 'INR';
    process.env.GEMINI_COST_PER_USD = '83.5';
    expect(displayCurrency()).toEqual({ code: 'INR', perUsd: 83.5 });
  });

  it('refuses to invent a rate when only the currency is set', () => {
    process.env.GEMINI_COST_CURRENCY = 'INR';
    expect(displayCurrency()).toEqual({ code: 'USD', perUsd: 1 });
  });

  it('ignores a nonsensical rate', () => {
    process.env.GEMINI_COST_CURRENCY = 'INR';
    process.env.GEMINI_COST_PER_USD = '-5';
    expect(displayCurrency()).toEqual({ code: 'USD', perUsd: 1 });
  });
});
