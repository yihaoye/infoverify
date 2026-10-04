// ---------- Deterministic scoring used by both the model and fallback paths ----------
import { clamp, countDistinctValues, getAnalysisText } from "./utils.js";
import { fallbackLanguageText } from "./language.js";
import { normalizeVerdict, averageRuleScores } from "./normalize.js";
import { mbfcFactualWeight } from "./mbfc.js";
import {
  SPECIFICITY_WEIGHTS as SW,
  CROSS_VALIDATION_WEIGHTS as CW,
  REPRODUCIBILITY_WEIGHTS as RW,
  VERDICT_THRESHOLDS as VT,
  capped
} from "./weights.js";
import { mergeEvidenceLists, buildFallbackEvidence } from "./evidence.js";
import { stanceStats, distinctDomains, distinctDates } from "./stance.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

export function buildDeterministicLocalAssessment(input, newsBundle, mbfcEntry, raw, outputLanguage) {
  const rule_scores = buildDeterministicRuleScores(input, newsBundle, mbfcEntry);
  const { verdict, confidence } = assessVerdict({ modelVerdict: "", ruleScores: rule_scores, items: newsBundle.items });
  const rationale = raw
    ? fallbackLanguageText(outputLanguage, "jsonFallback")
    : fallbackLanguageText(outputLanguage, "noOutput");
  return {
    verdict,
    confidence,
    summary: rationale,
    rationale,
    rule_scores,
    // The same rule summaries are already shown in each card; no separate note.
    rule_notes: null,
    evidence: mergeEvidenceLists(buildFallbackEvidence(input), newsBundle.items, input),
    news_query: newsBundle.query || "",
    news_summary: newsBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(newsBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(newsBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };
}

// `modelSpecificity` is the model's own 0-1 specificity judgement; when present
// it is averaged with the regex heuristic so neither one dominates.
export function buildDeterministicRuleScores(input, newsBundle, mbfcEntry, { modelSpecificity } = {}) {
  const heuristic = scoreSpecificity(input);
  const model = modelSpecificity == null || modelSpecificity === "" ? Number.NaN : Number(modelSpecificity);
  return {
    reproducibility: scoreReproducibility(newsBundle, mbfcEntry),
    cross_validation: scoreCrossValidation(newsBundle),
    detail_richness: Number.isFinite(model) ? clamp((heuristic + clamp(model, 0, 1)) / 2, 0, 1) : heuristic
  };
}

export function scoreSpecificity(input) {
  const text = getAnalysisText(input) || String(input?.selectionText || "");
  const normalized = String(text || "");
  // CJK text has no spaces between words (cloud mode sends it untranslated),
  // so count roughly one word per two ideographs / kana / hangul characters.
  const cjkChars = (normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const words = normalized.split(/\s+/).filter(Boolean).length + cjkChars / 2;
  const numbers = (normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const dates = (normalized.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{4}年\d{1,2}月\d{1,2}日)|(?:\d{1,2}\/\d{1,2}\/\d{4})/g) || []).length;
  const hasSpecificMarkers = /(?:%|\$|\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b)/.test(normalized);
  const score = SW.base + 
  Match.min(SW.wordsCap, words / SW.wordsDivisor) +
  capped(numbers, SW.numberStep, SW.numberCap) +
  capped(dates, SW.dateStep, SW.dateCap) +
  (hasSpecificMarkers ? SW.markerBonus : 0);
  return clamp(score, 0, 1);
}

// Independent publishers that support the claim raise the score; publishers that
// contradict it lower it. Irrelevant hits (keyword overlap only) count for
// nothing, and unlabeled hits are capped so a rule-only run cannot look
// strongly corroborated.
export function scoreCrossValidation(newsBundle) {
  const stats = stanceStats(newsBundle?.items);
  if (stats.support + stats.contradict + stats.unknown === 0) return CW.noEvidence;

  const score = CW.base +
    capped(stats.supportDomains, CW.supportStep, CW.supportCap) +
    capped(stats.unknownDomains, CW.unknownStep, CW.unknownCap) +
    capped(Math.max(0, distinctDates(stats.corroborating) - 1), CW.dateStep, CW.dateCap) -
    capped(stats.contradictDomains, CW.contradictStep, CW.contradictCap);
  return clamp(score, 0, 1);
}

// Stability over time plus source credibility: the page's own MBFC rating, how
// long and how widely the claim is repeated, and whether the repeating
// publishers are themselves rated mostly-factual or better.
export function scoreReproducibility(newsBundle, mbfcEntry) {
  const { corroborating } = stanceStats(newsBundle?.items);
  const domains = distinctDomains(corroborating);
  const credibleDomains = countDistinctValues(
    corroborating.filter((item) => Number(item.source_credibility) >= RW.credibleMinWeight).map((item) => item.domain).filter(Boolean)
  );
  const score = RW.base +
    (mbfcEntry ? mbfcFactualWeight(mbfcEntry) : 0) +
    capped(corroborating.length, RW.itemStep, RW.itemCap) +
    capped(Math.max(0, domains - 1), RW.domainStep, RW.domainCap) +
    capped(Math.max(0, distinctDates(corroborating) - 1), RW.dateStep, RW.dateCap) +
    capped(credibleDomains, RW.credibleStep, RW.credibleCap);
  return clamp(score, 0, 1);
}

// Single source of truth for the verdict and the headline score, so the pill
// and the percentage can never disagree (e.g. "supported" at 30%).
//
// - contradicted: more independent publishers contradict than support, or the
//   model says contradicted and the rule scores agree the claim is weak.
// - supported: at least one publisher supports it, the rule scores are solid,
//   and the model does not object.
// - otherwise unclear. Thin or off-topic evidence is "unclear", never
//   "contradicted".
export function assessVerdict({ modelVerdict, ruleScores, items }) {
  const credibility = averageRuleScores(ruleScores);
  const stats = stanceStats(items);
  const model = modelVerdict ? normalizeVerdict(modelVerdict) : "";

  let verdict = "unclear";
  if (stats.contradictDomains > stats.supportDomains) {
    verdict = "contradicted";
  } else if (model === "contradicted" && credibility < VT.modelContradictedBelow) {
    verdict = "contradicted";
  } else if (model !== "contradicted" && stats.supportDomains > 0 && credibility >= VT.supportedMin) {
    verdict = "supported";
  }

  const confidence = verdict === "contradicted" ? Math.min(credibility, VT.contradictedCap) : credibility;
  return { verdict, confidence: clamp(confidence, 0, 1) };
}
