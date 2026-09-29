// ---------- Error logging and status-line helpers ----------
import { DEBUG_PREFIX } from "./constants.js";
import { statusEl } from "./dom.js";

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
