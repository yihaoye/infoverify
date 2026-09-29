// ---------- Normalization of model output, verdicts, and parsed payloads ----------
import { clamp, sanitizeModelText } from "./utils.js";
import { buildFallbackEvidence } from "./evidence.js";

export function normalizeResult(payload, mode, input) {
  const result = {
    verdict: normalizeVerdict(payload?.verdict),
    confidence: normalizeConfidence(payload?.confidence),
    summary: sanitizeModelText(payload?.summary || payload?.rationale || "—") || "—",
    rationale: sanitizeModelText(payload?.rationale || payload?.summary || "—") || "—",
    rule_scores: normalizeRuleScores(payload?.rule_scores),
    rule_notes: normalizeRuleNotes(payload?.rule_notes),
    evidence: normalizeEvidence(payload?.evidence, input),
    mode,
    news_query: String(payload?.news_query || ""),
    news_summary: String(payload?.news_summary || ""),
    reproducibility_summary: String(payload?.reproducibility_summary || ""),
    cross_validation_summary: String(payload?.cross_validation_summary || ""),
    specificity_summary: String(payload?.specificity_summary || ""),
    timings: payload?.timings && typeof payload.timings === "object" ? payload.timings : null,
    elapsed_ms: Number(payload?.elapsed_ms) || 0
  };

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
        quote: input.selectionText || "",
        retrieved_at: input.capturedAt || new Date().toISOString(),
        source_type: "page"
      }
    ],
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

// A low score only means weak evidence, so it maps to "unclear". "contradicted"
// needs contradicting evidence or a model judgement (see assessVerdict).
export function verdictFromScore(score) {
  return score >= 0.7 ? "supported" : "unclear";
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
    source_type: String(item?.source_type || item?.type || "evidence"),
    ...(item?.stance ? { stance: String(item.stance) } : {})
  }));
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

// Reads the fields that are already complete in a partially streamed model
// response. The prompt orders them stances → specificity → verdict → summary,
// so `ready` (everything except the summary is known) becomes true before the
// summary text starts, and `summary` then grows chunk by chunk.
export function extractStreamingAssessment(text) {
  const raw = String(text || "");
  const stancesMatch = raw.match(/"stances"\s*:\s*\[([^\]]*)\]/);
  const specificityMatch = raw.match(/"specificity"\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}]/);
  const verdictMatch = raw.match(/"verdict"\s*:\s*"([a-z]+)"/i);
  const summaryMatch = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);

  const stances = stancesMatch
    ? [...stancesMatch[1].matchAll(/"([a-z]+)"/gi)].map((match) => match[1].toLowerCase())
    : null;
  return {
    ready: Boolean(stancesMatch && specificityMatch && verdictMatch),
    stances,
    specificity: specificityMatch ? Number(specificityMatch[1]) : null,
    verdict: verdictMatch ? verdictMatch[1].toLowerCase() : "",
    summary: summaryMatch ? decodePartialJsonString(summaryMatch[1]) : ""
  };
}

// Decodes a JSON string body that may be cut mid-escape (e.g. ends with "\").
function decodePartialJsonString(body) {
  let value = body;
  while (value) {
    try {
      return JSON.parse(`"${value}"`);
    } catch {
      value = value.slice(0, -1);
    }
  }
  return "";
}
