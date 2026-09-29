// ---------- MBFC dataset lookup and hostname normalization ----------
import { state } from "./state.js";

export function normalizeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return String(url || "").trim().replace(/^www\./i, "").toLowerCase();
  }
}

// Most specific first: "sport.bbc.co.uk" -> sport.bbc.co.uk, bbc.co.uk, co.uk.
// Stripping one label at a time (instead of keeping only the last two) keeps
// subdomains of multi-part suffixes such as .co.uk / .com.au matchable.
export function buildHostnameCandidates(hostname) {
  const parts = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  const candidates = [];
  for (let i = 0; i <= parts.length - 2; i += 1) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
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
    factual: String(entry.factual || entry.rating || "").trim(),
    notes: String(entry.notes || entry.summary || "").trim()
  };
}

// Reproducibility points for an MBFC factual-reporting rating. A "Mixed" or
// worse rating must not score better than an unrated domain, so only
// mostly-factual and above add points and low ratings subtract.
const MBFC_FACTUAL_WEIGHTS = {
  veryhigh: 0.3,
  high: 0.22,
  mostlyfactual: 0.12,
  mixed: 0,
  low: -0.12,
  verylow: -0.2
};

export function mbfcFactualWeight(entry) {
  const key = String(entry?.factual || entry?.rating || "").toLowerCase().replace(/[^a-z]/g, "");
  return MBFC_FACTUAL_WEIGHTS[key] ?? 0;
}

function datasetEntries(dataset) {
  if (Array.isArray(dataset)) return dataset;
  if (Array.isArray(dataset?.domains)) return dataset.domains;
  if (dataset?.domains && typeof dataset.domains === "object") {
    return Object.entries(dataset.domains).map(([domain, value]) => ({ domain, ...value }));
  }
  return [];
}

function findMbfcEntry(dataset, hostname) {
  if (!hostname) return null;
  const entries = datasetEntries(dataset);
  for (const candidate of buildHostnameCandidates(hostname)) {
    const match = entries.find((entry) => normalizeHostname(entry?.domain || entry?.url || entry?.site || "") === candidate);
    if (match) return normalizeMbfcEntry(match, candidate);
  }
  return null;
}

export async function lookupMbfcEntry(url) {
  const hostname = normalizeHostname(url);
  if (!hostname) return null;
  const dataset = await loadMbfcDataset();
  return dataset ? findMbfcEntry(dataset, hostname) : null;
}

// Tags each news item with its publisher's MBFC factual weight (null when the
// publisher is not in the dataset) so scoring can reward credible corroboration.
export async function annotateSourceCredibility(items) {
  const list = Array.isArray(items) ? items : [];
  const dataset = await loadMbfcDataset();
  if (!dataset) return list.map((item) => ({ ...item, source_credibility: null }));
  return list.map((item) => {
    const entry = findMbfcEntry(dataset, item?.domain || "");
    return { ...item, source_credibility: entry ? mbfcFactualWeight(entry) : null };
  });
}
