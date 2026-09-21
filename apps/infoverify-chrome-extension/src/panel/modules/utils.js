// ---------- Generic helpers with no panel-specific dependencies ----------
export function getAnalysisText(input) {
  const analysisText = String(input?.analysisText || "").trim();
  if (analysisText) return analysisText;
  const selection = String(input?.selectionText || "").trim();
  return selection;
}

export function countDistinctValues(values) {
  return new Set(values.filter(Boolean)).size;
}

export function summarizeCounts(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
}

// Sentinel returned by formatDateOnly when a date is missing or unparsable.
export const UNKNOWN_DATE = "未知";

export function formatDateOnly(value) {
  if (!value) return UNKNOWN_DATE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return UNKNOWN_DATE;
  return parsed.toISOString().slice(0, 10);
}

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function formatError(err) {
  const message = String(err?.message || err || "Unknown error");
  return `Analysis unavailable: ${message}`;
}

export function sanitizeModelText(value) {
  const text = String(value || "")
    .replace(/^﻿/, "")
    .trim();
  if (!text) return "";

  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => sanitizeModelText(item)).filter(Boolean).join(" ");
    }
    if (parsed && typeof parsed === "object") {
      return sanitizeModelText(parsed.summary || parsed.rationale || parsed.message || parsed.text || "");
    }
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // Plain text is the expected UI format.
  }
  return text;
}

export async function safeReadText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}
