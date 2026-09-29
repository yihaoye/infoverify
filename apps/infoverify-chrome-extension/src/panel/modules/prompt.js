// ---------- Local model prompt construction and output schema ----------
import { formatDateOnly, getAnalysisText } from "./utils.js";
import { getLanguageLabel } from "./language.js";

// On-device decoding speed is the main latency cost, so the model is asked only
// for what the rules cannot compute: per-item stance, a specificity judgement,
// its verdict, and short prose. Reproducibility and cross-validation scores are
// derived deterministically from those stances plus MBFC.
export function buildLocalPrompt(input, newsBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en") {
  const analysisText = getAnalysisText(input);
  const outputLanguageLabel = getLanguageLabel(modelOutputLanguage);
  const displayLanguageLabel = getLanguageLabel(displayLanguage);
  const items = Array.isArray(newsBundle?.items) ? newsBundle.items : [];
  const newsLines = items.length > 0
    ? items.map((item, index) => {
        const source = item.source || item.source_type || "Google News";
        const quote = item.quote || "";
        return `${index + 1}. ${formatDateOnly(item.retrieved_at)} · ${source} · ${item.title || item.url || "Google News match"}${quote ? `\n   ${quote}` : ""}`;
      }).join("\n")
    : "(no results)";
  const mbfcLine = mbfcEntry
    ? `${mbfcEntry.hostname} · factual ${mbfcEntry.factual || mbfcEntry.rating || "unknown"}`
    : "not rated";
  return [
    "You are an information verification assistant. Judge only from the claim, the numbered Google News results, and your training knowledge. Do not invent outside facts.",
    `Write summary, rationale, and rule_notes in ${outputLanguageLabel}.`,
    displayLanguage === "zh" ? `The user interface will translate the final answer into ${displayLanguageLabel}.` : "",
    "Tasks:",
    `1) stances: exactly ${items.length} labels, one per numbered news result in order. "support" = the result reports the same claim as true; "contradict" = it denies, debunks, or reports conflicting facts; "irrelevant" = a different event or topic. Sharing keywords is not support.`,
    "2) specificity: 0 to 1, how concrete and falsifiable the claim is (who/what/when/where, precise numbers that actually back the conclusion, little vagueness).",
    "3) verdict: supported, contradicted, or unclear. Use unclear when the evidence is thin, mixed, or off-topic.",
    "Return ONLY one compact JSON object:",
    `{"verdict":"supported|contradicted|unclear","stances":["support|contradict|irrelevant"],"specificity":0.0,"summary":"...","rationale":"...","rule_notes":{"reproducibility":"...","cross_validation":"...","detail_richness":"..."}}`,
    "Keep summary, rationale, and each rule note under 120 characters. rule_notes: reproducibility = stability over time and source credibility; cross_validation = which publishers support or contradict; detail_richness = specificity.",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    `Page source reputation (MBFC): ${mbfcLine}`,
    "Claim to verify:",
    analysisText,
    "",
    newsBundle?.anchorDate ? `News anchor date: ${newsBundle.anchorDate}` : "",
    "Google News results:",
    newsLines
  ].filter((line) => line !== "").join("\n");
}

// JSON Schema passed as the Prompt API `responseConstraint`, so the model can
// only emit parsable JSON. Deliberately limited to type/enum/properties/
// required/items; counts and ranges are enforced by the normalizers instead.
export function buildLocalResponseSchema() {
  const text = { type: "string" };
  return {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["supported", "contradicted", "unclear"] },
      stances: { type: "array", items: { type: "string", enum: ["support", "contradict", "irrelevant"] } },
      specificity: { type: "number" },
      summary: text,
      rationale: text,
      rule_notes: {
        type: "object",
        properties: { reproducibility: text, cross_validation: text, detail_richness: text },
        required: ["reproducibility", "cross_validation", "detail_richness"]
      }
    },
    required: ["verdict", "stances", "specificity", "summary", "rationale", "rule_notes"]
  };
}
