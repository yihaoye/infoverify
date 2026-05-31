// ---------- Generic helpers with no panel-specific dependencies ----------
export function getAnalysisText(input) {
  const analysisText = String(input?.analysisText || "").trim();
  if (analysisText) return analysisText;
  const selection = String(input?.selectionText || "").trim();
  if (selection) return selection;
  return String(input?.pageText || "").trim();
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
  return `Local AI unavailable: ${message}`;
}

export function sanitizeModelText(value) {
  return String(value || "")
    .replace(/^﻿/, "")
    .trim();
}

export async function safeReadText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    if (signal?.aborted) {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
