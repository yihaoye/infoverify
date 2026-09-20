// ---------- Local model prompt construction and output schema ----------
import { getAnalysisText } from "./utils.js";
import { getLanguageLabel } from "./language.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

export function buildLocalPrompt(input, newsBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en") {
  const analysisText = getAnalysisText(input);
  const specificitySummary = buildSpecificitySummary(input, "en");
  const crossValidationSummary = buildCrossValidationSummary(newsBundle, "en");
  const reproducibilitySummary = buildReproducibilitySummary(newsBundle, mbfcEntry, "en");
  const outputLanguageLabel = getLanguageLabel(modelOutputLanguage);
  const displayLanguageLabel = getLanguageLabel(displayLanguage);
  const newsLines = Array.isArray(newsBundle?.items) && newsBundle.items.length > 0
    ? newsBundle.items.map((item, index) => {
        const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
        const source = item.source || item.source_type || "Google News";
        const quote = item.quote || "";
        return `${index + 1}. ${date} · ${source} · ${item.title || item.url || "Google News match"}${quote ? `\n   ${quote}` : ""}`;
      }).join("\n")
    : "This query did not find a sufficiently close Google News result.";
  const newsQueryLine = newsBundle?.query ? `Google News query: ${newsBundle.query}` : "Google News query: (empty)";
  const newsAnchorLine = newsBundle?.anchorDate ? `News anchor date: ${newsBundle.anchorDate}` : "News anchor date: (none)";
  return [
    "You are an information verification assistant. Judge only from the text below, the Google News evidence, and your training knowledge. Do not browse the web or invent outside facts.",
    `Write the final answer in ${outputLanguageLabel}.`,
    displayLanguage === "zh" ? `The user interface will translate the final answer into ${displayLanguageLabel}.` : "",
    "Evaluate the statement using three principles:",
    "1) Specificity: judge the density and falsifiability of the claim itself. Focus on DIKW depth, 5W1H completeness, relevance between numbers and conclusions, precision of details, and low information entropy.",
    "2) Cross-validation: judge whether independent sources support the claim. Focus on distinct publisher domains, source spread, and consistency with basic scientific knowledge.",
    "3) Reproducibility: judge the claim's stability over time and the credibility of the source. Focus on MBFC domain reputation, first/recent appearance time, and whether different sources repeat the claim over time.",
    "Google News evidence is the main input for cross-validation. MBFC is only for reproducibility and source credibility.",
    "Return ONLY valid JSON with these keys:",
    `{ "verdict": "supported|contradicted|unclear", "confidence": 0.0, "overall_score": 0.0, "summary": "short ${outputLanguageLabel} summary", "rationale": "short ${outputLanguageLabel} explanation", "rule_scores": {"reproducibility": 0.0, "cross_validation": 0.0, "detail_richness": 0.0}, "rule_notes": {"reproducibility": "...", "cross_validation": "...", "detail_richness": "..."}, "evidence": [{"title":"...", "url":"...", "quote":"..."}], "conflicts": ["..."], "missing": ["..."] }`,
    "Rules:",
    "- The verdict must reflect the claim's overall credibility.",
    "- confidence and overall_score must be numbers between 0 and 1.",
    "- rule_scores must correspond to reproducibility, cross_validation, and detail_richness.",
    "- rule_notes should briefly explain why each score was assigned and should cite Google News/MBFC clues when possible.",
    "- evidence quotes should be exact or near-exact excerpts from the source.",
    "- If the claim is too weak, too vague, or cannot be verified, return unclear.",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    `Selection: ${input.selectionText || ""}`,
    "Page text:",
    analysisText || input.pageText || input.selectionText || "",
    "",
    newsQueryLine,
    newsAnchorLine,
    "Specificity cues:",
    specificitySummary,
    "",
    "Cross-validation cues:",
    crossValidationSummary,
    "",
    "Reproducibility cues:",
    reproducibilitySummary,
    "",
    "Google News evidence bundle:",
    newsLines
  ].join("\n");
}
