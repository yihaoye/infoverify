// ---------- Cloud AI (BYOK) orchestration: Google Gemini + Google Search grounding ----------
import { GEMINI_ORIGIN, GEMINI_API_BASE, GEMINI_DEFAULT_MODEL } from "./constants.js";
import { reportError } from "./logging.js";
import { getAnalysisText, sanitizeModelText, safeReadText } from "./utils.js";
import { getPreferredOutputLanguage, getLanguageLabel, resolveOutputLanguage } from "./language.js";
import { lookupMbfcEntry, normalizeHostname, annotateSourceCredibility } from "./mbfc.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";
import { buildDeterministicRuleScores, assessVerdict } from "./scoring.js";
import { mergeEvidenceLists } from "./evidence.js";
import { normalizeRuleNotes, parseAssessmentJson } from "./normalize.js";

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

// Gemini writes in the same output language as the rule summaries: the one
// chosen in Settings, or the browser language for "auto" (as in local mode).
function cloudLanguageInstruction(outputLanguage) {
  return `Write summary and rule_notes in ${getLanguageLabel(outputLanguage)}.`;
}

// Same contract as the local prompt (stances → specificity → verdict →
// summary), except Gemini finds its own sources with Google Search, so it lists
// them with a stance each instead of labeling a numbered list. Scores and the
// final verdict are computed by the shared rules, not taken from Gemini.
function buildCloudPrompt(input, analysisText, languageInstruction) {
  return [
    "You are an information verification assistant with web search.",
    "Use Google Search to find independent, reputable sources that report on the claim before answering. Do not use the page under review as a source.",
    languageInstruction,
    "Tasks:",
    `1) sources: up to ${MAX_CLOUD_SOURCES} distinct publishers you actually found. For each: publisher name, the publisher's website domain (e.g. reuters.com), the article URL, its publication date (YYYY-MM-DD, or "" if unknown), and stance. "support" = it reports the same claim as true; "contradict" = it denies, debunks, or reports conflicting facts; "irrelevant" = a different event or topic. Sharing keywords is not support.`,
    "2) specificity: 0 to 1, how concrete and falsifiable the claim is (who/what/when/where, precise numbers that actually back the conclusion, little vagueness).",
    "3) verdict: supported, contradicted, or unclear, based on your sources above. Use unclear when the evidence is thin, mixed, or off-topic.",
    "Return ONLY one compact JSON object:",
    `{"sources":[{"publisher":"...","domain":"...","url":"...","date":"YYYY-MM-DD","stance":"support|contradict|irrelevant"}],"specificity":0.0,"verdict":"supported|contradicted|unclear","summary":"...","rule_notes":{"reproducibility":"...","cross_validation":"...","detail_richness":"..."}}`,
    "summary: one or two sentences explaining the verdict, naming the publishers that support or contradict it. rule_notes briefly justify: reproducibility = stability over time and source credibility; cross_validation = which publishers support or contradict; detail_richness = specificity.",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    "Claim to verify:",
    analysisText || input.selectionText || ""
  ].join("\n");
}

const MAX_CLOUD_SOURCES = 6;

// Grounding chunk URIs are Google redirect links, so the publisher is read from
// the chunk title (usually its domain, e.g. "reuters.com"), falling back to the
// URI's host when that is not a redirect.
const HOSTNAME_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

function groundedDomain(web) {
  const title = String(web?.title || "").trim().toLowerCase();
  if (HOSTNAME_PATTERN.test(title)) return normalizeHostname(title);
  const host = normalizeHostname(web?.uri || "");
  return host.endsWith("vertexaisearch.cloud.google.com") ? "" : host;
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
  const grounded = (grounding.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter(Boolean)
    .map((web) => ({
      title: String(web.title || web.uri || "Source").trim(),
      url: String(web.uri || "").trim(),
      domain: groundedDomain(web),
      source: String(web.title || "").trim(),
      quote: "",
      retrieved_at: "",
      source_type: "web"
    }));
  const searchQueries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [];

  return { text, grounded, searchQueries };
}

// Turns Gemini's listed sources into scoring items (same shape as Google News
// items). Links prefer the grounded redirect URL for the same domain, which is
// known to resolve, over a URL Gemini wrote itself.
function buildSourceItems(parsedSources, grounded) {
  const groundedByDomain = new Map(grounded.filter((item) => item.domain).map((item) => [item.domain, item]));
  const seen = new Set();
  const items = [];
  for (const source of Array.isArray(parsedSources) ? parsedSources : []) {
    const domain = normalizeHostname(source?.domain || source?.url || "");
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const publisher = String(source?.publisher || "").trim() || domain;
    const modelUrl = String(source?.url || "").trim();
    items.push({
      title: publisher,
      url: groundedByDomain.get(domain)?.url || (/^https?:\/\//i.test(modelUrl) ? modelUrl : ""),
      quote: "",
      retrieved_at: String(source?.date || "").trim(),
      source_type: "web",
      source: publisher,
      domain,
      stance: String(source?.stance || "").toLowerCase()
    });
    if (items.length >= MAX_CLOUD_SOURCES) break;
  }
  return items;
}

const CLOUD_SEARCH_COPY = {
  en: { empty: "Web search returned no grounded sources for this claim.", queries: "Search queries", sources: "Grounded web sources" },
  es: { empty: "La búsqueda web no devolvió fuentes para esta afirmación.", queries: "Consultas de búsqueda", sources: "Fuentes web consultadas" },
  ja: { empty: "ウェブ検索でこの主張の情報源は見つかりませんでした。", queries: "検索クエリ", sources: "参照したウェブ情報源" },
  zh: { empty: "网页搜索没有为这条主张找到来源。", queries: "搜索词", sources: "参考的网页来源" }
};

function buildCloudSearchSummary(grounded, searchQueries, outputLanguage) {
  const copy = CLOUD_SEARCH_COPY[resolveOutputLanguage(outputLanguage)] || CLOUD_SEARCH_COPY.en;
  if (grounded.length === 0 && searchQueries.length === 0) return copy.empty;
  const lines = [];
  if (searchQueries.length > 0) lines.push(`${copy.queries}: ${searchQueries.join("; ")}`);
  lines.push(`${copy.sources}: ${grounded.length}`);
  for (const source of grounded.slice(0, 3)) {
    lines.push(`· ${source.title || source.url}`);
  }
  return lines.join("\n");
}

export async function runCloudAnalysis(input, signal) {
  const config = await getCloudConfig();
  if (!config.apiKey) {
    throw new Error("Add your Gemini API key in Settings to use Cloud AI.");
  }
  if (!(await chrome.permissions.contains({ origins: [GEMINI_ORIGIN] }))) {
    throw new Error("Cloud AI needs permission to connect to the Gemini API. Select Cloud AI again in Settings to grant it.");
  }

  // Gemini handles the source language natively, so the text is sent verbatim
  // (no local detection/translation).
  const outputLanguage = await getPreferredOutputLanguage();
  const analysisText = getAnalysisText(input);
  const prompt = buildCloudPrompt(input, analysisText, cloudLanguageInstruction(outputLanguage));

  const { text, grounded, searchQueries } = await callGemini(config, prompt, signal);
  const parsed = parseAssessmentJson(text);
  if (!parsed) {
    reportError("cloud AI parse fallback", new Error("model output did not parse as JSON"), {
      rawPreview: text.slice(0, 500)
    });
  }

  // Without parsable output the grounded sources are used unlabeled, which the
  // rules treat as weak corroboration only (as in the local fallback).
  const labeled = parsed ? buildSourceItems(parsed.sources, grounded) : [];
  const [mbfcEntry, items] = await Promise.all([
    lookupMbfcEntry(input.url || ""),
    annotateSourceCredibility(labeled.length > 0 ? labeled : grounded)
  ]);
  const bundle = { items, query: searchQueries.join("; "), summary: "" };

  const ruleScores = buildDeterministicRuleScores(input, bundle, mbfcEntry, {
    modelSpecificity: parsed?.specificity
  });
  const { verdict, confidence } = assessVerdict({
    modelVerdict: parsed?.verdict || "",
    ruleScores,
    items
  });
  const summary = parsed
    ? sanitizeModelText(parsed.summary || "") || "Cloud AI analysis completed."
    : sanitizeModelText(text) || "Cloud AI returned no parsable output; showing rule-based scores.";

  return {
    verdict,
    confidence,
    summary,
    rationale: "",
    rule_scores: ruleScores,
    rule_notes: parsed ? normalizeRuleNotes(parsed.rule_notes) : null,
    evidence: mergeEvidenceLists([], items, input),
    news_query: searchQueries.join(", "),
    news_summary: buildCloudSearchSummary(grounded, searchQueries, outputLanguage),
    reproducibility_summary: buildReproducibilitySummary(bundle, mbfcEntry, outputLanguage, { source: "web" }),
    cross_validation_summary: buildCrossValidationSummary(bundle, outputLanguage, { source: "web" }),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };
}
