/**
 * CATEGORIZATION_SCHEMA — the invariants the rest of the system leans on.
 *
 * This taxonomy is not just a list. Roughly 96k stored analyses carry its
 * strings, the Gemini prompt is this object stringified, every category filter
 * and report dimension is drawn from it, and scripts/taxonomy-analysis derives
 * a rule's category from its sub-category. It has already been re-cut once —
 * 17 categories folded into 5 — so the properties that survived that are worth
 * stating out loud rather than rediscovering the next time.
 */
process.env.NODE_ENV  = 'test';
process.env.LOG_LEVEL = 'error';

const { CATEGORIZATION_SCHEMA } = require('../src/services/geminiService');

const categories = Object.keys(CATEGORIZATION_SCHEMA);
const subs = Object.values(CATEGORIZATION_SCHEMA).flat();

describe('shape', () => {
  it('holds the five categories, in the order the schema declares them', () => {
    expect(categories).toEqual([
      'Account Access & Application Details / Eligibility',
      'Documents & Identity Verification',
      'Payment & Fee',
      'Amendment & Changes in Form',
      'General',
    ]);
  });

  it('carries all 196 sub-categories, distributed as specified', () => {
    expect(subs).toHaveLength(196);
    expect(Object.fromEntries(categories.map(c => [c, CATEGORIZATION_SCHEMA[c].length]))).toEqual({
      'Account Access & Application Details / Eligibility': 91,
      'Documents & Identity Verification': 28,
      'Payment & Fee': 14,
      'Amendment & Changes in Form': 13,
      'General': 50,
    });
  });

  it('has no empty category', () => {
    for (const [name, list] of Object.entries(CATEGORIZATION_SCHEMA)) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(name.trim()).toBe(name);
    }
  });
});

/**
 * The property that lets a sub-category stand alone. classify.js depends on it
 * to derive a rule's category, which is what let the 17→5 re-cut land without
 * touching a single rule. Lose it and that indirection silently picks one of
 * two categories.
 */
describe('sub-categories are unique across categories', () => {
  it('never repeats a sub-category', () => {
    const seen = new Map();
    const collisions = [];
    for (const [cat, list] of Object.entries(CATEGORIZATION_SCHEMA)) {
      for (const sub of list) {
        if (seen.has(sub)) collisions.push(`"${sub}" in both ${seen.get(sub)} and ${cat}`);
        else seen.set(sub, cat);
      }
    }
    expect(collisions).toEqual([]);
    expect(seen.size).toBe(subs.length);
  });

  it('has no blank or untrimmed sub-category', () => {
    for (const sub of subs) {
      expect(typeof sub).toBe('string');
      expect(sub.trim()).toBe(sub);
      expect(sub.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Dispositions are triage outcomes — decided before categorisation, and stored
 * as sentinel category values. Letting one into the schema would offer Gemini
 * "Duplicate" as an answer to "what did this candidate need", and it would take
 * it.
 */
describe('dispositions stay out', () => {
  const DISPOSITIONS = [
    'Blank', 'Duplicate', 'Call too Short', 'Audio Unclear', 'Content Unclear',
    'Email too Short', 'Bank Notification', 'Courtesy / Thank You', 'Thank You',
    'Auto-Reply', 'Unclear', 'Issue Text Unclear', 'Uncategorised',
  ];

  it.each(DISPOSITIONS)('does not offer %s as a sub-category', name => {
    expect(subs).not.toContain(name);
  });

  it.each(DISPOSITIONS)('does not offer %s as a category', name => {
    expect(categories).not.toContain(name);
  });
});

/**
 * One taxonomy now serves calls and mail, so a name that only makes sense on a
 * phone line describes half its records wrongly.
 */
describe('channel-neutral naming', () => {
  it.each([
    ['Call Back Request',         'Contact Request'],
    ['Unrelated / Wrong Call',    'Out-of-Scope Contact'],
    ['Repeated Call / Follow-up', 'Repeated Contact / Follow-up'],
  ])('replaced %s with %s', (oldName, newName) => {
    expect(subs).not.toContain(oldName);
    expect(subs).toContain(newName);
  });

  it('leaves no other call-only wording in a sub-category', () => {
    // "Call Centre" would be fine; a sub-category ABOUT a call is not, now that
    // the same entry has to describe an email.
    const callOnly = subs.filter(s => /\b(call|caller|dial|phone line)\b/i.test(s));
    expect(callOnly).toEqual([]);
  });
});
