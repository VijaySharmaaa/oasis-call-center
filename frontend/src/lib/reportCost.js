/**
 * Formatting for the Gemini spend figures.
 *
 * One analysis can cost a small fraction of a cent, so a plain 2-decimal
 * format would print a real day's spend as "$0.00" — which reads as free. The
 * precision below scales to the magnitude instead, and only an actual zero is
 * ever shown as zero.
 */

const SYMBOLS = { USD: '$', INR: '₹', EUR: '€', GBP: '£' };

/**
 * @param {number|null} usd     amount in USD, as the API reports it
 * @param {object} currency     { code, perUsd } from the report
 * @returns {string} e.g. "$1.24", "$0.0031", "—"
 */
export function formatMoney(usd, { code = 'USD', perUsd = 1 } = {}) {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '—';

  const value = usd * perUsd;
  const symbol = SYMBOLS[code] ?? '';
  const prefix = symbol || `${code} `;

  if (value === 0) return `${prefix}0`;

  // Enough decimals to show something, however small the amount.
  const decimals = Math.abs(value) >= 1 ? 2 : Math.abs(value) >= 0.01 ? 3 : 4;
  return `${prefix}${value.toFixed(decimals)}`;
}

/** Token counts read better abbreviated once they run to millions. */
export function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}
