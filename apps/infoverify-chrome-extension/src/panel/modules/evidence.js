// ---------- Evidence list construction and merging ----------
export function buildFallbackEvidence(input) {
  return [
    {
      title: input.title || "Current page",
      url: input.url || "",
      quote: input.selectionText || input.pageText?.slice(0, 180) || "",
      retrieved_at: input.capturedAt || new Date().toISOString(),
      source_type: "page"
    }
  ];
}

// Canonical form of a URL for comparison: host (without www) + path, lowercased,
// ignoring scheme, query, hash, and trailing slash.
function canonicalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return `${u.hostname.replace(/^www\./i, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return raw.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

export function mergeEvidenceLists(primary, secondary, input) {
  // Cross-validation evidence is independent corroboration only, so exclude the
  // page being verified — it is the subject, not a corroborating source. (It is
  // injected as a fallback by buildFallbackEvidence and as the default URL for
  // model evidence items that omit one.)
  const subject = canonicalUrl(input?.url);
  const seen = new Set();
  const merged = [];

  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const title = String(item?.title || item?.url || "").trim();
    const url = String(item?.url || "").trim();
    const quote = String(item?.quote || "").trim();
    if (!title && !url && !quote) continue;
    if (subject && url && canonicalUrl(url) === subject) continue;
    const key = `${title}|${url}|${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      title: title || url || "Evidence",
      url,
      quote,
      retrieved_at: String(item?.retrieved_at || ""),
      source_type: String(item?.source_type || item?.type || "evidence")
    });
  }

  return merged;
}
