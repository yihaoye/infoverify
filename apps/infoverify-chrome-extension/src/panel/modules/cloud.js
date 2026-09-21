// ---------- Cloud AI (BYOK) orchestration: Google Gemini + Google Search grounding ----------
import { DEBUG_PREFIX, GEMINI_API_BASE, GEMINI_DEFAULT_MODEL, SUPPORTED_OUTPUT_LANGUAGES } from "./constants.js";
import { setStatus, truncateForDebug, buildDebugTrace } from "./logging.js";
import { getAnalysisText, sanitizeModelText, safeReadText } from "./utils.js";
import { getPreferredOutputLanguage, getLanguageLabel } from "./language.js";
import { lookupMbfcEntry, normalizeHostname } from "./mbfc.js";
import { buildSpecificitySummary } from "./summaries.js";
import { buildDeterministicRuleScores } from "./scoring.js";
import { mergeEvidenceLists } from "./evidence.js";
import {
  normalizeRuleScores,
  normalizeRuleNotes,
  normalizeConfidence,
  normalizeVerdict,
  normalizeEvidence,
  normalizeList,
  verdictFromScore,
  averageRuleScores,
  parseAssessmentJson
} from "./normalize.js";

// The API key and model are stored in chrome.storage.local (never sync) so the
// secret stays on this device. See the Options page and PRIVACY.md.
export async function getCloudConfig() {
  const { cloudApiKey = "", cloudModel = "" } = await chrome.storage.local.get({
    cloudApiKey: "",
    cloudModel: ""
  });
  return {
    apiKey: String(cloudApiKey || "").trim(),
    model: String(cloudModel || "").trim() || GEMINI_DEFAULT_MODEL
  };
}

export async function isCloudConfigured() {
  const { apiKey } = await getCloudConfig();
  return Boolean(apiKey);
}

// Resolves the language instruction for Gemini. When the user picked a specific
// output language we name it; when the preference is "auto" we hand detection to
// Gemini itself (no local language detection) and ask it to reply in the claim's
// own language.
async function resolveCloudLanguage() {
  const { outputLanguage = "auto" } = await chrome.storage.sync.get({ outputLanguage: "auto" });
  const pref = String(outputLanguage || "auto").toLowerCase();
  if (SUPPORTED_OUTPUT_LANGUAGES.has(pref)) {
    const label = getLanguageLabel(pref);
    return {
      langName: label,
      instruction: `Write the entire final answer (summary, rationale, and rule_notes) in ${label}.`
    };
  }
  return {
    langName: "the same language as the claim",
    instruction: "Detect the primary language of the claim text below and write the entire final answer (summary, rationale, and rule_notes) in that same language."
  };
}

function buildCloudPrompt(input, analysisText, language) {
  const outputLanguageLabel = language.langName;
  return [
    "You are an information verification assistant with web search.",
    "Use Google Search to find independent, reputable sources that corroborate or contradict the claim before answering.",
    language.instruction,
    "Evaluate the statement using three principles:",
    "1) Specificity: judge the density and falsifiability of the claim itself — DIKW depth, 5W1H completeness, relevance between numbers and conclusions, precision of details, and low information entropy.",
    "2) Cross-validation: judge whether independent web sources support the claim. Prefer multiple reputable, independent domains; note disagreement.",
    "3) Reproducibility: judge the claim's stability over time and the credibility of the sources you found.",
    "Return ONLY valid JSON with these keys:",
    `{ "verdict": "supported|contradicted|unclear", "confidence": 0.0, "overall_score": 0.0, "summary": "short ${outputLanguageLabel} summary", "rationale": "short ${outputLanguageLabel} explanation", "rule_scores": {"reproducibility": 0.0, "cross_validation": 0.0, "detail_richness": 0.0}, "rule_notes": {"reproducibility": "...", "cross_validation": "...", "detail_richness": "..."}, "evidence": [{"title":"...", "url":"...", "quote":"..."}], "conflicts": ["..."], "missing": ["..."] }`,
    "Rules:",
    "- The verdict must reflect the claim's overall credibility.",
    "- confidence, overall_score, and every rule_score must be numbers between 0 and 1.",
    "- evidence must cite the actual web pages you found (real URLs and near-exact quotes), not the page under review.",
    "- rule_notes should briefly justify each score and reference the sources you used.",
    "- If the claim is too weak, too vague, or cannot be verified, return unclear.",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    "Selected text to verify:",
    analysisText || input.selectionText || ""
  ].join("\n");
}

async function callGemini({ apiKey, model }, prompt, signal) {
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal
  });

  if (!resp.ok) {
    const text = await safeReadText(resp);
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Gemini rejected the API key (HTTP ${resp.status}). Check your key in Settings.`);
    }
    if (resp.status === 429) {
      throw new Error("Gemini rate limit reached (HTTP 429). Please wait and try again.");
    }
    throw new Error(`Gemini HTTP ${resp.status}${text ? ` - ${text.slice(0, 300)}` : ""}`);
  }

  const data = await resp.json();
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  const grounding = candidate?.groundingMetadata || {};
  const sources = (grounding.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter(Boolean)
    .map((web) => ({
      title: String(web.title || web.uri || "Source").trim(),
      url: String(web.uri || "").trim(),
      // Common evidence fields let the deterministic scorer reuse grounded sources.
      domain: normalizeHostname(web.uri || web.title || ""),
      quote: "",
      retrieved_at: "",
      source_type: "web"
    }));
  const searchQueries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [];

  return { text, sources, searchQueries };
}

function buildCloudSearchSummary(sources, searchQueries) {
  if (sources.length === 0 && searchQueries.length === 0) {
    return "Web search returned no grounded sources for this claim.";
  }
  const lines = [];
  if (searchQueries.length > 0) lines.push(`Search queries: ${searchQueries.join("; ")}`);
  lines.push(`Grounded web sources: ${sources.length}`);
  for (const source of sources.slice(0, 3)) {
    lines.push(`· ${source.title || source.url}`);
  }
  return lines.join("\n");
}

function buildCloudCrossValidationSummary(sources) {
  return `Web corroboration via Google Search: ${sources.length} source(s). Cross-validation is stronger when multiple independent, reputable domains agree.`;
}

function buildCloudReproducibilitySummary(mbfcEntry) {
  const credibility = mbfcEntry
    ? `Source credibility (MBFC): ${mbfcEntry.hostname}${mbfcEntry.rating ? ` · ${mbfcEntry.rating}` : ""}. `
    : "No MBFC match for this domain. ";
  return `${credibility}Reproducibility is stronger when reputable sources repeat the claim over time.`;
}

export async function runCloudAnalysis(input, signal) {
  const config = await getCloudConfig();
  if (!config.apiKey) {
    throw new Error("Add your Gemini API key in Settings to use Cloud AI.");
  }

  // Gemini handles the source language natively, so we send the text verbatim
  // (no local detection/translation). `outputLanguage` is still resolved for the
  // deterministic summary templates; the Gemini-authored fields follow `language`.
  const outputLanguage = await getPreferredOutputLanguage();
  const language = await resolveCloudLanguage();
  const analysisText = getAnalysisText(input);
  const prompt = buildCloudPrompt(input, analysisText, language);

  setStatus("Calling cloud AI (Gemini)...");
  const { text, sources, searchQueries } = await callGemini(config, prompt, signal);
  console.info(`${DEBUG_PREFIX} cloud AI raw output`, {
    model: config.model,
    sources: sources.length,
    searchQueries,
    rawPreview: truncateForDebug(text, 3500)
  });

  const mbfcEntry = await lookupMbfcEntry(input.url || "");
  const pseudoBundle = { items: sources, query: searchQueries.join("; "), summary: "" };
  const parsed = parseAssessmentJson(text);

  const searchSummary = buildCloudSearchSummary(sources, searchQueries);
  const base = {
    news_query: searchQueries.join(", "),
    news_summary: searchSummary,
    reproducibility_summary: buildCloudReproducibilitySummary(mbfcEntry),
    cross_validation_summary: buildCloudCrossValidationSummary(sources),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };

  if (!parsed) {
    const ruleScores = buildDeterministicRuleScores(input, pseudoBundle, mbfcEntry);
    const confidence = normalizeConfidence(averageRuleScores(ruleScores));
    const rationale = sanitizeModelText(text) || "Cloud AI returned no parsable output; showing rule-based scores.";
    return {
      verdict: normalizeVerdict(verdictFromScore(confidence)),
      confidence,
      summary: rationale,
      rationale,
      rule_scores: ruleScores,
      rule_notes: null,
      evidence: mergeEvidenceLists([], sources, input),
      conflicts: [],
      missing: [rationale],
      ...base,
      debug_trace: buildDebugTrace({
        stage: "cloud-parse-fallback",
        outputLanguage,
        prompt,
        raw: text,
        parsed: null,
        error: "raw output did not parse as JSON",
        mbfc: mbfcEntry
      })
    };
  }

  let ruleScores = normalizeRuleScores(parsed.rule_scores);
  if (ruleScores.reproducibility === 0 && ruleScores.cross_validation === 0 && ruleScores.detail_richness === 0) {
    ruleScores = buildDeterministicRuleScores(input, pseudoBundle, mbfcEntry);
  }
  const overallScore = normalizeConfidence(parsed.overall_score ?? parsed.confidence ?? averageRuleScores(ruleScores));

  return {
    verdict: normalizeVerdict(parsed.verdict || verdictFromScore(overallScore)),
    confidence: overallScore,
    summary: sanitizeModelText(parsed.summary || parsed.rationale || "Cloud AI analysis completed."),
    rationale: sanitizeModelText(parsed.rationale || parsed.summary || "Cloud AI analysis completed."),
    rule_scores: ruleScores,
    rule_notes: normalizeRuleNotes(parsed.rule_notes),
    evidence: mergeEvidenceLists(normalizeEvidence(parsed.evidence, input), sources, input),
    conflicts: normalizeList(parsed.conflicts),
    missing: normalizeList(parsed.missing),
    ...base
  };
}
