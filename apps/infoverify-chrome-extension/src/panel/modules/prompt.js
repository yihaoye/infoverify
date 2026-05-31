// ---------- Local model prompt construction and output schema ----------
import { getAnalysisText } from "./utils.js";
import { getLanguageLabel } from "./language.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

export function buildLocalPrompt(input, gdeltBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en") {
  const analysisText = getAnalysisText(input);
  const specificitySummary = buildSpecificitySummary(input, "en");
  const crossValidationSummary = buildCrossValidationSummary(gdeltBundle, "en");
  const reproducibilitySummary = buildReproducibilitySummary(gdeltBundle, mbfcEntry, "en");
  const outputLanguageLabel = getLanguageLabel(modelOutputLanguage);
  const displayLanguageLabel = getLanguageLabel(displayLanguage);
  const gdeltLines = Array.isArray(gdeltBundle?.items) && gdeltBundle.items.length > 0
    ? gdeltBundle.items.map((item, index) => {
        const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
        const source = item.source || item.source_type || "GDELT";
        const country = item.country ? ` · ${item.country}` : "";
        const tone = item.tone ? ` · tone=${item.tone}` : "";
        const quote = item.quote || "";
        return `${index + 1}. ${date}${country}${tone} · ${source} · ${item.title || item.url || "GDELT match"}${quote ? `\n   ${quote}` : ""}`;
      }).join("\n")
    : "This query did not find a sufficiently close GDELT news event.";
  const gdeltQueryLine = gdeltBundle?.query ? `GDELT query: ${gdeltBundle.query}` : "GDELT query: (empty)";
  const gdeltAnchorLine = gdeltBundle?.anchorDate ? `GDELT anchor date: ${gdeltBundle.anchorDate}` : "GDELT anchor date: (none)";
  return [
    "You are an information verification assistant. Judge only from the text below, the GDELT evidence, and your training knowledge. Do not browse the web or invent outside facts.",
    `Write the final answer in ${outputLanguageLabel}.`,
    displayLanguage === "zh" ? `The user interface will translate the final answer into ${displayLanguageLabel}.` : "",
    "Evaluate the statement using three principles:",
    "1) Specificity: judge the density and falsifiability of the claim itself. Focus on DIKW depth, 5W1H completeness, relevance between numbers and conclusions, precision of details, and low information entropy.",
    "2) Cross-validation: judge whether independent sources support the claim. Focus on GDELT's distinct domains, source-country spread, tone consistency, and consistency with basic scientific knowledge.",
    "3) Reproducibility: judge the claim's stability over time and the credibility of the source. Focus on MBFC domain reputation, whether the event persists in GDELT, first/recent appearance time, and whether different sources repeat the claim over time.",
    "GDELT evidence is the main input for cross-validation. MBFC is only for reproducibility and source credibility.",
    "Return ONLY valid JSON with these keys:",
    `{ "verdict": "supported|contradicted|unclear", "confidence": 0.0, "overall_score": 0.0, "summary": "short ${outputLanguageLabel} summary", "rationale": "short ${outputLanguageLabel} explanation", "rule_scores": {"reproducibility": 0.0, "cross_validation": 0.0, "detail_richness": 0.0}, "rule_notes": {"reproducibility": "...", "cross_validation": "...", "detail_richness": "..."}, "evidence": [{"title":"...", "url":"...", "quote":"..."}], "conflicts": ["..."], "missing": ["..."] }`,
    "Rules:",
    "- The verdict must reflect the claim's overall credibility.",
    "- confidence and overall_score must be numbers between 0 and 1.",
    "- rule_scores must correspond to reproducibility, cross_validation, and detail_richness.",
    "- rule_notes should briefly explain why each score was assigned and should cite GDELT/MBFC clues when possible.",
    "- evidence quotes should be exact or near-exact excerpts from the source.",
    "- If the claim is too weak, too vague, or cannot be verified, return unclear.",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    `Selection: ${input.selectionText || ""}`,
    "Page text:",
    analysisText || input.pageText || input.selectionText || "",
    "",
    gdeltQueryLine,
    gdeltAnchorLine,
    "Specificity cues:",
    specificitySummary,
    "",
    "Cross-validation cues:",
    crossValidationSummary,
    "",
    "Reproducibility cues:",
    reproducibilitySummary,
    "",
    "GDELT evidence bundle:",
    gdeltLines
  ].join("\n");
}
