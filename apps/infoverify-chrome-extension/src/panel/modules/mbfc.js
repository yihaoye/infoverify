// ---------- MBFC dataset lookup and hostname normalization ----------
import { state } from "./state.js";

export function normalizeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return String(url || "").trim().replace(/^www\./i, "").toLowerCase();
  }
}

export function buildHostnameCandidates(hostname) {
  const parts = String(hostname || "").split(".").filter(Boolean);
  const candidates = [];
  if (parts.length >= 2) {
    candidates.push(parts.slice(-2).join("."));
  }
  candidates.push(String(hostname || "").toLowerCase());
  return [...new Set(candidates)];
}

export async function loadMbfcDataset() {
  if (!state.mbfcDatasetPromise) {
    state.mbfcDatasetPromise = fetch(chrome.runtime.getURL("src/data/mbfc.json"))
      .then((resp) => (resp.ok ? resp.json() : null))
      .catch(() => null);
  }
  return state.mbfcDatasetPromise;
}

export function normalizeMbfcEntry(entry, hostname) {
  if (!entry || typeof entry !== "object") return null;
  const rating = String(entry.rating || entry.score || entry.bias || entry.classification || "").trim();
  const label = String(entry.label || entry.name || entry.title || hostname || "").trim();
  const url = String(entry.url || entry.site || hostname || "").trim();
  return {
    hostname,
    label,
    url,
    rating,
    notes: String(entry.notes || entry.summary || "").trim()
  };
}

export async function lookupMbfcEntry(url) {
  const hostname = normalizeHostname(url);
  if (!hostname) return null;

  const dataset = await loadMbfcDataset();
  if (!dataset) return null;

  const entries = Array.isArray(dataset)
    ? dataset
    : Array.isArray(dataset?.domains)
      ? dataset.domains
      : dataset?.domains && typeof dataset.domains === "object"
        ? Object.entries(dataset.domains).map(([domain, value]) => ({ domain, ...value }))
        : [];

  const candidates = buildHostnameCandidates(hostname);
  for (const candidate of candidates) {
    const match = entries.find((entry) => normalizeHostname(entry?.domain || entry?.url || entry?.site || "") === candidate);
    if (match) {
      return normalizeMbfcEntry(match, candidate);
    }
  }

  return null;
}
