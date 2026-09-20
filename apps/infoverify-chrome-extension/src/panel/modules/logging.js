// ---------- Logging, status, and debug-trace helpers ----------
import { DEBUG_PREFIX } from "./constants.js";
import { state } from "./state.js";
import { statusEl, debugCardEl, debugTraceEl, debugStatusEl } from "./dom.js";

export function reportError(stage, error, context = {}) {
  const message = error?.message || String(error || "Unknown error");
  console.error(`${DEBUG_PREFIX} ${stage}`, {
    message,
    stack: error?.stack || "",
    context,
    error
  });
}

export function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

export function truncateForDebug(value, maxChars = 6000) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

export function buildDebugTrace(fields) {
  return JSON.stringify(
    {
      stage: fields.stage || "unknown",
      outputLanguage: fields.outputLanguage || "en",
      modelOutputLanguage: fields.modelOutputLanguage || "en",
      promptPreview: truncateForDebug(fields.prompt, 2500),
      rawPreview: truncateForDebug(fields.raw, 3500),
      parsedPreview: fields.parsed || null,
      error: fields.error || "",
      newsSummary: truncateForDebug(fields.newsSummary, 1200),
      newsRawPreview: truncateForDebug(fields.newsRawPreview, 1200),
      mbfc: fields.mbfc || null
    },
    null,
    2
  );
}

export function setDebugTrace(trace) {
  state.lastDebugTrace = String(trace || "");
  if (!state.lastDebugTrace) {
    debugCardEl.hidden = true;
    debugTraceEl.textContent = "";
    debugStatusEl.textContent = "—";
    return;
  }

  debugCardEl.hidden = false;
  debugTraceEl.textContent = state.lastDebugTrace;
  debugStatusEl.textContent = "Copy this and paste it here for troubleshooting";
}
