/**
 * Date formatting for the report.
 *
 * Its own module because the sheets file may only export components — a
 * helper exported beside them breaks fast refresh.
 */

/** The template's date format: DD/MM/YYYY from an ISO YYYY-MM-DD. */
export function ddmmyyyy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Today as YYYY-MM-DD in local time — the day boundary the API reports on. */
export function todayStr() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * A YYYY-MM-DD offset by whole days, rolling over months and years.
 *
 * Built from numeric parts so the arithmetic stays in local time: parsing
 * '2026-08-18' as a Date treats it as UTC, which shifts the result by a day
 * for anyone east or west of Greenwich.
 */
export function shiftDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + delta);
  const p = n => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${p(shifted.getMonth() + 1)}-${p(shifted.getDate())}`;
}
