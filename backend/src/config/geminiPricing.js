/**
 * What a Gemini call costs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE RATES ARE A STARTING POINT, NOT A SOURCE OF TRUTH.
 * Google changes Gemini pricing, and the rates below were written from the
 * public price list at the time this module was added. Check them against
 * https://ai.google.dev/pricing before anyone spends money on the strength of
 * a number this produces, and correct them here (or via GEMINI_PRICING) if
 * they have moved. The report prints the rate card it used, so a stale rate
 * is visible on the page rather than hidden behind a total.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rates are USD per MILLION tokens. Input is split by modality because the
 * 2.5 models charge audio input at several times the text rate, and a call
 * recording is almost entirely audio tokens — pricing it at the text rate
 * would understate the bill by a wide margin.
 *
 * A model with no entry here is not guessed at. Its usage is counted as
 * UNPRICED and reported separately, so the total always reads as "at least
 * this much" rather than silently omitting spend.
 */

const logger = require('../logger');

/** USD per 1M tokens. `audio` applies to AUDIO-modality input tokens only. */
const DEFAULT_RATES = {
  'gemini-2.5-flash':      { text: 0.30,  audio: 1.00, output: 2.50 },
  'gemini-2.5-flash-lite': { text: 0.10,  audio: 0.30, output: 0.40 },
  'gemini-1.5-flash':      { text: 0.075, audio: 0.30, output: 0.30 },
  'gemini-1.5-flash-8b':   { text: 0.0375, audio: 0.15, output: 0.15 },
};

/**
 * Effective rate card: the defaults, with any GEMINI_PRICING overrides merged
 * over them. Read at call time rather than captured at module load, so a
 * deployment can correct a rate without a code change.
 *
 * GEMINI_PRICING is JSON, e.g.
 *   {"gemini-2.5-flash":{"text":0.30,"audio":1.00,"output":2.50}}
 */
function rateCard() {
  const raw = process.env.GEMINI_PRICING;
  if (!raw || !raw.trim()) return { ...DEFAULT_RATES };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return { ...DEFAULT_RATES, ...parsed };
  } catch (err) {
    // A malformed override must not silently fall back to numbers the operator
    // thinks they replaced — say so loudly, then use the defaults.
    logger.warn('[Pricing] GEMINI_PRICING is not valid JSON — using default rates', { error: err.message });
    return { ...DEFAULT_RATES };
  }
}

/** The rates for one model, or null when it is not priced. */
function ratesFor(model) {
  if (!model) return null;
  const card = rateCard();
  return card[model] ?? null;
}

/**
 * Cost of one analysis, in USD.
 *
 * @param {object} usage as persisted on the analysis document:
 *        { model, prompt_tokens, output_tokens, modalities: { TEXT, AUDIO, … } }
 * @returns {{usd: number|null, priced: boolean, reason?: string}}
 *          usd is null when the cost is unknown — never 0, because 0 is a
 *          claim about spend and "unknown" is not.
 */
function costOf(usage) {
  if (!usage) return { usd: null, priced: false, reason: 'no usage recorded' };

  const rates = ratesFor(usage.model);
  if (!rates) return { usd: null, priced: false, reason: `no rate for ${usage.model || 'unknown model'}` };

  const modalities = usage.modalities || {};
  const audioTokens = Number(modalities.AUDIO) || 0;
  const prompt = Number(usage.prompt_tokens) || 0;
  // Anything not itemised as audio is charged at the text rate. Falling back to
  // the whole prompt keeps older records — captured before the modality split
  // existed — priced rather than dropped.
  const textTokens = Math.max(0, prompt - audioTokens);
  const output = Number(usage.output_tokens) || 0;

  const usd =
    (textTokens  / 1e6) * rates.text +
    (audioTokens / 1e6) * rates.audio +
    (output      / 1e6) * rates.output;

  return { usd, priced: true };
}

/**
 * Sum the cost of many analyses, keeping what could not be priced visible.
 *
 * @returns {{usd: number, priced: number, unpriced: number, tokens: {...}}}
 */
function totalCost(usages) {
  let usd = 0, priced = 0, unpriced = 0;
  let promptTokens = 0, outputTokens = 0, audioTokens = 0;

  for (const usage of usages) {
    const { usd: one, priced: ok } = costOf(usage);
    if (ok) { usd += one; priced += 1; } else { unpriced += 1; }

    if (usage) {
      promptTokens += Number(usage.prompt_tokens) || 0;
      outputTokens += Number(usage.output_tokens) || 0;
      audioTokens  += Number(usage.modalities?.AUDIO) || 0;
    }
  }

  return {
    // Sub-cent precision matters: one analysis can cost a fraction of a cent,
    // and rounding each to 2dp before summing would report a day as free.
    usd: Math.round(usd * 1e6) / 1e6,
    priced,
    unpriced,
    tokens: { prompt: promptTokens, output: outputTokens, audio: audioTokens },
  };
}

/**
 * Optional display currency. Google bills in USD; an operator who wants the
 * report in local currency sets a conversion rate explicitly rather than the
 * code inventing one.
 *
 *   GEMINI_COST_CURRENCY=INR
 *   GEMINI_COST_PER_USD=83.5
 */
function displayCurrency() {
  const code = (process.env.GEMINI_COST_CURRENCY || 'USD').trim().toUpperCase();
  const perUsd = Number(process.env.GEMINI_COST_PER_USD);

  if (code === 'USD' || !Number.isFinite(perUsd) || perUsd <= 0) {
    return { code: 'USD', perUsd: 1 };
  }
  return { code, perUsd };
}

module.exports = { rateCard, ratesFor, costOf, totalCost, displayCurrency, DEFAULT_RATES };
