// ------ Rule-scoring weights and verdict thresholds -------
// Every rule score is 0-1: a base plus capped bonuses, each computed as
// min(cap, count × step). The values are hand-tuned against a handful of
// claims; change them here and run `node --test` (repo root) to see which expected
// verdicts move.

export const SPECIFICITY_WEIGHTS = {
  base: 0.16,
  // Length bonus = words / wordsDivisor, capped (reached at ~75 words).
  wordsDivisor: 220,
  wordsCap: 0.34,
  numberStep: 0.05,
  numberCap: 0.2,
  dateStep: 0.06,
  dateCap: 0.14,
  // %, $, or an all-caps ticker / acronym.
  markerBonus: 0.08
}

export const CROSS_VALIDATION_WEIGHTS = {
  // No support, contradiction, or unlabeled result at all.
  noEvidence: 0.12,
  base: 0.2,
  // Per independent publisher domain.
  supportStep: 0.15,
  supportCap: 0.45,
  // Unlabeled results (rule-only fallback) are a weak signal only.
  unknownStep: 0.05,
  unknownCap: 0.15,
  // Per extra distinct publication day among corroborating results.
  dateStep: 0.05,
  dateCap: 0.15,
  // Subtracted per contradicting publisher domain.
  contradictStep: 0.2,
  contradictCap: 0.4
};

export const REPRODUCIBILITY_WEIGHTS = {
  base: 0.2,
  itemStep: 0.03,
  itemCap: 0.12,
  // Per extra corroborating publisher domain.
  domainStep: 0.06,
  domainCap: 0.12,
  // Per extra distinct publication day.
  dateStep: 0.07,
  dateCap: 0.14,
  // Per corroborating publisher rated at least `credibleMinWeight` by MBFC.
  credibleStep: 0.04,
  credibleCap: 0.12,
  credibleMinWeight: 0.12
};

// Reproducibility points for an MBFC factual-reporting rating. A "Mixed" or
// worse rating must not score better than an unrated domain, so only
// mostly-factual and above add points and low ratings subtract.
export const MBFC_FACTUAL_WEIGHTS = {
  veryhigh: 0.3,
  high: 0.22,
  mostlyfactual: 0.12,
  mixed: 0,
  low: -0.12,
  verylow: -0.2
};

export const VERDICT_THRESHOLDS = {
  // Minimum average rule score for "supported" (plus at least one supporting
  // publisher and no model objection).
  supportedMin: 0.55,
  // A model 'contradicted" is accepted only below this average rule score.
  modelContradictedBelow: 0.5,
  // Headline score cap for "contradicted", so the pill and % never disagree.
  contradictedCap: 0.35
};

export function capped(count, step, cap) {
  return Math.min(cap, count * step);
}
