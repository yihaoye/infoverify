// ---------- Local model prompt construction and output schema ----------
import { formatDateOnly, getAnalysisText } from "./utils.js";
import { getLanguageLabel } from "./language.js";

// On-device decoding speed is the main latency cost, so the model is asked only
// for what the rules cannot compute: per-item stance, a specificity judgement,
// its verdict, and a one-line summary. Per-principle notes come from the rule
// summaries instead of model output.
//
// The prompt is split in two so the fixed instructions can be sent to the
// session (session.append) while Google News is still being fetched; only the
// run-specific evidence is processed after the fetch.
export function buildLocalInstructions(modelOutputLanguage = "en", displayLanguage = "en") {
  const outputLanguageLabel = getLanguageLabel(modelOutputLanguage);
  const displayLanguageLabel = getLanguageLabel(displayLanguage);
  return [
    "You are an information verification assistant. Judge only from the claim, the numbered Google News results, and your training knowledge. Do not invent outside facts.",
    `Write the summary in ${outputLanguageLabel}.`,
    displayLanguage === "zh" ? `The user interface will translate the final answer into ${displayLanguageLabel}.` : "",
    "Tasks:",
    `1) stances: exactly one label per numbered news result, in order. "support" = the result reports the same claim as true; "contradict" = it denies, debunks, or reports conflicting facts; "irrelevant" = a different event or topic. Sharing keywords is not support.`,
    "2) specificity: 0 to 1, how concrete and falsifiable the claim is (who/what/when/where, precise numbers that actually back the conclusion, little vagueness).",
    "3) verdict: supported, contradicted, or unclear, based on your stances above. Use unclear when the evidence is thin, mixed, or off-topic.",
    "Return ONLY one compact JSON object:",
    // Stances and specificity come before the verdict so the model commits to
    // per-source judgements first and conditions its verdict on them.
    `{"stances":["support|contradict|irrelevant"],"specificity":0.0,"verdict":"supported|contradicted|unclear","summary":"..."}`,
    "summary: one sentence under 150 characters explaining the verdict, naming the publishers that support or contradict it when there are any.",
    "The claim and the news results follow."
  ].filter((line) => line !== "").join("\n");
}

// `claimInContext`: the session already holds the claim and title from the
// search-query turn, so they are referenced instead of being processed again.
export function buildLocalEvidencePrompt(input, newsBundle, mbfcEntry, { claimInContext = false } = {}) {
  const items = Array.isArray(newsBundle?.items) ? newsBundle.items : [];
  const newsLines = items.length > 0
    ? items.map((item, index) => {
        const source = item.source || item.source_type || "Google News";
        // Local-edition results carry an English translation for the model.
        const title = item.title_en || item.title || item.url || "Google News match";
        const quote = item.title_en || item.quote || "";
        return `${index + 1}. ${formatDateOnly(item.retrieved_at)} · ${source} · ${title}${quote ? `\n   ${quote}` : ""}`;
      }).join("\n")
    : "(no results)";
  const mbfcLine = mbfcEntry
    ? `${mbfcEntry.hostname} · factual ${mbfcEntry.factual || mbfcEntry.rating || "unknown"}`
    : "not rated";
  return [
    `URL: ${input.url || ""}`,
    claimInContext ? "" : `Title: ${input.title || ""}`,
    `Page source reputation (MBFC): ${mbfcLine}`,
    claimInContext ? "Claim to verify: the claim text from the earlier message (not the search query)." : "Claim to verify:",
    claimInContext ? "" : getAnalysisText(input),
    newsBundle?.anchorDate ? `News anchor date: ${newsBundle.anchorDate}` : "",
    `Google News results (${items.length}):`,
    newsLines
  ].filter((line) => line !== "").join("\n");
}

// Single-message form, used when the instructions could not be sent ahead.
export function buildLocalPrompt(input, newsBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en", options = {}) {
  return [
    buildLocalInstructions(modelOutputLanguage, displayLanguage),
    buildLocalEvidencePrompt(input, newsBundle, mbfcEntry, options)
  ].join("\n\n");
}

// JSON Schema passed as the Prompt API `responseConstraint`, so the model can
// only emit parsable JSON. Deliberately limited to type/enum/properties/
// required/items; counts and ranges are enforced by the normalizers instead.
export function buildLocalResponseSchema() {
  return {
    type: "object",
    properties: {
      stances: { type: "array", items: { type: "string", enum: ["support", "contradict", "irrelevant"] } },
      specificity: { type: "number" },
      verdict: { type: "string", enum: ["supported", "contradicted", "unclear"] },
      summary: { type: "string" }
    },
    required: ["stances", "specificity", "verdict", "summary"]
  };
}
