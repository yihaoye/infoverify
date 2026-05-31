// ---------- Deterministic scoring used by both the model and fallback paths ----------
import { clamp, countDistinctValues, formatDateOnly, getAnalysisText, sanitizeModelText, UNKNOWN_DATE } from "./utils.js";
import { fallbackLanguageText } from "./language.js";
import { normalizeConfidence, normalizeVerdict, verdictFromScore, averageRuleScores } from "./normalize.js";
import { mergeEvidenceLists, buildFallbackEvidence } from "./evidence.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

export function buildDeterministicLocalAssessment(input, gdeltBundle, mbfcEntry, raw, outputLanguage) {
  const rule_scores = buildDeterministicRuleScores(input, gdeltBundle, mbfcEntry);
  const confidence = normalizeConfidence(averageRuleScores(rule_scores));
  const rationale = sanitizeModelText(raw) || fallbackLanguageText(outputLanguage, "noOutput");
  return {
    verdict: normalizeVerdict(verdictFromScore(confidence)),
    confidence,
    summary: rationale,
    rationale,
    rule_scores,
    rule_notes: {
      reproducibility: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
      cross_validation: buildCrossValidationSummary(gdeltBundle, outputLanguage),
      detail_richness: buildSpecificitySummary(input, outputLanguage)
    },
    evidence: mergeEvidenceLists(buildFallbackEvidence(input), gdeltBundle.items, input),
    conflicts: [],
    missing: raw ? [fallbackLanguageText(outputLanguage, "jsonFallback")] : [fallbackLanguageText(outputLanguage, "noOutput")],
    gdelt_summary: gdeltBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(gdeltBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };
}

export function buildDeterministicRuleScores(input, gdeltBundle, mbfcEntry) {
  return {
    reproducibility: scoreReproducibility(gdeltBundle, mbfcEntry),
    cross_validation: scoreCrossValidation(gdeltBundle),
    detail_richness: scoreSpecificity(input)
  };
}

export function scoreSpecificity(input) {
  const text = getAnalysisText(input) || `${input?.selectionText || ""} ${input?.pageText || ""}`;
  const normalized = String(text || "");
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const numbers = (normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const dates = (normalized.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{4}年\d{1,2}月\d{1,2}日)|(?:\d{1,2}\/\d{1,2}\/\d{4})/g) || []).length;
  const hasSpecificMarkers = /(?:%|\$|\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b)/.test(normalized);
  const score = 0.16 + Math.min(0.34, words / 220) + Math.min(0.2, numbers * 0.05) + Math.min(0.14, dates * 0.06) + (hasSpecificMarkers ? 0.08 : 0);
  return clamp(score, 0, 1);
}

export function scoreCrossValidation(gdeltBundle) {
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  if (items.length === 0) return 0.12;

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const countries = countDistinctValues(items.map((item) => item.country).filter(Boolean));
  const dates = countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== UNKNOWN_DATE));
  const toneCount = countDistinctValues(items.map((item) => item.tone).filter(Boolean));
  const score = 0.22 +
    Math.min(0.22, items.length * 0.04) +
    Math.min(0.16, Math.max(0, domains - 1) * 0.08) +
    Math.min(0.12, Math.max(0, countries - 1) * 0.06) +
    Math.min(0.12, Math.max(0, dates - 1) * 0.05) +
    Math.min(0.08, Math.max(0, toneCount - 1) * 0.04);
  return clamp(score, 0, 1);
}

export function scoreReproducibility(gdeltBundle, mbfcEntry) {
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const dates = countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== UNKNOWN_DATE));
  const hasMbfc = Boolean(mbfcEntry);
  const score = 0.2 +
    (hasMbfc ? 0.22 : 0) +
    Math.min(0.18, items.length * 0.03) +
    Math.min(0.18, Math.max(0, domains - 1) * 0.08) +
    Math.min(0.14, Math.max(0, dates - 1) * 0.07);
  return clamp(score, 0, 1);
}
