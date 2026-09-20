// ---------- Normalization of model output, verdicts, and parsed payloads ----------
import { clamp, sanitizeModelText } from "./utils.js";
import { buildFallbackEvidence } from "./evidence.js";
import { buildDebugTrace } from "./logging.js";

export function normalizeResult(payload, mode, input) {
  const result = {
    verdict: normalizeVerdict(payload?.verdict),
    confidence: normalizeConfidence(payload?.confidence),
    summary: sanitizeModelText(payload?.summary || payload?.rationale || "—") || "—",
    rationale: sanitizeModelText(payload?.rationale || payload?.summary || "—") || "—",
    rule_scores: normalizeRuleScores(payload?.rule_scores),
    rule_notes: normalizeRuleNotes(payload?.rule_notes),
    evidence: normalizeEvidence(payload?.evidence, input),
    conflicts: normalizeList(payload?.conflicts),
    missing: normalizeList(payload?.missing),
    llm_assessment: payload?.llm_assessment || null,
    debug_trace: String(payload?.debug_trace || ""),
    mode,
    news_query: String(payload?.news_query || ""),
    news_summary: String(payload?.news_summary || ""),
    reproducibility_summary: String(payload?.reproducibility_summary || ""),
    cross_validation_summary: String(payload?.cross_validation_summary || ""),
    specificity_summary: String(payload?.specificity_summary || "")
  };

  if (!result.llm_assessment) {
    result.llm_assessment = {
      verdict: result.verdict === "supported" ? "high" : result.verdict === "contradicted" ? "low" : "unclear",
      confidence: result.confidence,
      rationale: result.rationale,
      summary: result.summary
    };
  }

  return result;
}

export function errorResult({ input, mode, message }) {
  return {
    verdict: "unclear",
    summary: message,
    rationale: message,
    confidence: 0,
    evidence: [
      {
        title: input.title || "Current page",
        url: input.url || "",
        quote: input.selectionText || input.pageText?.slice(0, 160) || "",
        retrieved_at: input.capturedAt || new Date().toISOString(),
        source_type: "page"
      }
    ],
    conflicts: [],
    missing: [message],
    llm_assessment: {
      verdict: "unclear",
      confidence: 0,
      rationale: message,
      error: message
    },
    debug_trace: buildDebugTrace({
      stage: "error",
      error: message,
      prompt: "",
      raw: "",
      parsed: null
    }),
    mode,
    news_summary: ""
  };
}

export function normalizeRuleScores(ruleScores) {
  const scores = ruleScores && typeof ruleScores === "object" ? ruleScores : {};
  return {
    reproducibility: normalizeConfidence(scores.reproducibility ?? scores.repro ?? scores.repeatability),
    cross_validation: normalizeConfidence(scores.cross_validation ?? scores.cross ?? scores.validation),
    detail_richness: normalizeConfidence(scores.detail_richness ?? scores.detail ?? scores.dikw)
  };
}

export function normalizeRuleNotes(ruleNotes) {
  if (!ruleNotes || typeof ruleNotes !== "object") return null;
  return {
    reproducibility: sanitizeModelText(ruleNotes.reproducibility || ruleNotes.repro || ""),
    cross_validation: sanitizeModelText(ruleNotes.cross_validation || ruleNotes.cross || ""),
    detail_richness: sanitizeModelText(ruleNotes.detail_richness || ruleNotes.detail || "")
  };
}

export function averageRuleScores(ruleScores) {
  const values = [
    ruleScores?.reproducibility,
    ruleScores?.cross_validation,
    ruleScores?.detail_richness
  ].filter((value) => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function verdictFromScore(score) {
  if (score >= 0.7) return "supported";
  if (score <= 0.3) return "contradicted";
  return "unclear";
}

export function formatScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "—";
  return `${Math.round(score * 100)}%`;
}

export function normalizeEvidence(evidence, input) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return buildFallbackEvidence(input);
  }

  return evidence.map((item) => ({
    title: String(item?.title || item?.source || input.title || "Evidence"),
    url: String(item?.url || input.url || ""),
    quote: String(item?.quote || item?.excerpt || item?.rationale || "").trim(),
    retrieved_at: String(item?.retrieved_at || input.capturedAt || new Date().toISOString()),
    source_type: String(item?.source_type || item?.type || "evidence")
  }));
}

export function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

export function normalizeVerdict(verdict) {
  const value = String(verdict || "").toLowerCase();
  if (value === "supported" || value === "contradicted" || value === "unclear") {
    return value;
  }
  return "unclear";
}

export function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return clamp(num, 0, 1);
}

export function parseAssessmentJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidate = candidate.slice(first, last + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
