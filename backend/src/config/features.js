/**
 * Feature flags read from the environment.
 *
 * Flags are read at CALL time, never captured at module load, so a test can
 * flip process.env between assertions without re-requiring the module graph.
 */

// Accepts 1/true/yes/on (case-insensitive). Everything else — including an
// unset var, an empty string, or a typo — is false. Opt-in flags must never
// switch themselves on because someone wrote `ENABLED=maybe`.
function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * DYNAMIC_CATEGORIES_ENABLED — the "invent categories" path.
 *
 * OFF (the default): call_category / call_sub_category are derived from the
 * hardcoded CATEGORIZATION_SCHEMA only. Gemini is never asked to pick from,
 * or add to, the `call_categories` collection; the taxonomy generators are
 * refused; and the hourly worker stops minting new call categories.
 *
 * ON: the pre-existing behaviour — Gemini picks from the live `call_categories`
 * taxonomy, /generate-categories and /generalise-categories can rewrite it,
 * and the hourly worker creates new entries for anything Uncategorised.
 *
 * Turned off by default because the dynamic taxonomy had drifted to 292
 * invented category names against a 17-category hardcoded schema.
 */
function dynamicCategoriesEnabled() {
  return envBool('DYNAMIC_CATEGORIES_ENABLED', false);
}

module.exports = { envBool, dynamicCategoriesEnabled };
