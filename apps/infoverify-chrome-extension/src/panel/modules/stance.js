// ---------- News item stance labels and per-stance statistics ----------
import { countDistinctValues, formatDateOnly, UNKNOWN_DATE } from "./utils.js";

// News item stance toward the claim. "unknown" means no model labeled it (the
// rule-only fallback, or cloud grounding sources), so it is only a weak signal.
export const STANCES = ["support", "contradict", "irrelevant"];

export function applyStances(items, stances) {
  const list = Array.isArray(items) ? items : [];
  const labels = Array.isArray(stances) ? stances : [];
  return list.map((item, index) => {
    const stance = String(labels[index] || "").toLowerCase();
    return { ...item, stance: STANCES.includes(stance) ? stance : "unknown" };
  });
}

function itemStance(item) {
  return STANCES.includes(item?.stance) ? item.stance : "unknown";
}

export function distinctDomains(items) {
  return countDistinctValues(items.map((item) => item.domain).filter(Boolean));
}

export function distinctDates(items) {
  return countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== UNKNOWN_DATE));
}

export function stanceStats(items) {
  const list = Array.isArray(items) ? items : [];
  const by = (stance) => list.filter((item) => itemStance(item) === stance);
  const support = by("support");
  const contradict = by("contradict");
  const unknown = by("unknown");
  return {
    support: support.length,
    contradict: contradict.length,
    irrelevant: by("irrelevant").length,
    unknown: unknown.length,
    supportDomains: distinctDomains(support),
    contradictDomains: distinctDomains(contradict),
    unknownDomains: distinctDomains(unknown),
    // Items that could corroborate the claim: labeled support, or unlabeled.
    corroborating: [...support, ...unknown]
  };
}
