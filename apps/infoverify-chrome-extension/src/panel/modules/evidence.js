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

export function mergeEvidenceLists(primary, secondary, input) {
  const seen = new Set();
  const merged = [];

  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const title = String(item?.title || item?.url || "").trim();
    const url = String(item?.url || "").trim();
    const quote = String(item?.quote || "").trim();
    const key = `${title}|${url}|${quote}`;
    if (!title && !url && !quote) continue;
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

  return merged.length > 0 ? merged : buildFallbackEvidence(input);
}
