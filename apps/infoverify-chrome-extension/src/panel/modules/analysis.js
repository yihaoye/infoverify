// ---------- Local AI orchestration and scoring pipeline ----------
import { DEBUG_PREFIX } from "./constants.js";
import { googleNewsSummaryEl, thinkingTextEl } from "./dom.js";
import { reportError, truncateForDebug, buildDebugTrace, setStatus } from "./logging.js";
import { sanitizeModelText } from "./utils.js";
import {
  getPreferredOutputLanguage,
  resolveModelOutputLanguage,
  prepareEnglishAnalysisInput,
  localizeAssessmentResult,
  fallbackLanguageText
} from "./language.js";
import { createLanguageModelSession } from "./model.js";
import { fetchGoogleNewsBundle, extractAnchorDate, summarizeGoogleNewsBundle } from "./google_news.js";
import { lookupMbfcEntry } from "./mbfc.js";
import { buildLocalPrompt } from "./prompt.js";
import { buildDeterministicLocalAssessment, buildDeterministicRuleScores } from "./scoring.js";
import {
  normalizeRuleScores,
  normalizeRuleNotes,
  normalizeVerdict,
  normalizeEvidence,
  normalizeList,
  verdictFromScore,
  averageRuleScores,
  parseAssessmentJson
} from "./normalize.js";
import { mergeEvidenceLists } from "./evidence.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

export async function promptLocalAssessment(session, prompt, signal) {
  return await session.prompt(prompt, { signal });
}

export async function runLocalAnalysis(input, signal) {
  const outputLanguage = await getPreferredOutputLanguage();
  const modelOutputLanguage = resolveModelOutputLanguage(outputLanguage);

  // Create the model session up front. If "Analyze" was clicked before the
  // model finished downloading, this also drives the (gesture-authorized)
  // download — doing it before the slower translation and Google News steps keeps the
  // click's user gesture valid. The dedicated "Download local AI" button is the
  // primary way to perform the one-time download.
  //
  // A failure here must NOT discard the run: the three rule scores are derived
  // from Google News / MBFC / specificity, not from the AI verdict, so when the model
  // is unavailable we still return rule-based scores (with a clear reason)
  // instead of an empty 0% result.
  let session = null;
  let sessionError = null;
  try {
    session = await createLanguageModelSession(modelOutputLanguage, signal, {
      onDownloadProgress: (percent) => {
        setStatus(`Downloading local AI model… ${percent}%`);
        thinkingTextEl.textContent = `Downloading the local AI model (one-time setup): ${percent}%`;
      }
    });
    setStatus("Calling local AI...");
    thinkingTextEl.textContent = "Analyzing text, searching Google News, and generating a local conclusion";
  } catch (err) {
    sessionError = err;
    reportError("createLanguageModelSession", err, { outputLanguage, modelOutputLanguage });
  }

  const preparedInput = await prepareEnglishAnalysisInput(input, signal);

  googleNewsSummaryEl.textContent = "Searching Google News...";
  let newsBundle;
  try {
    newsBundle = await fetchGoogleNewsBundle(preparedInput, signal, outputLanguage);
  } catch (err) {
    reportError("fetchGoogleNewsBundle", err, {
      input: { url: preparedInput.url, title: preparedInput.title },
      outputLanguage
    });
    const anchorDate = extractAnchorDate(preparedInput);
    const errorMessage = `Google News fetch failed: ${String(err?.message || err)}`;
    newsBundle = {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage,
      rawPreview: "",
      summary: summarizeGoogleNewsBundle("", [], errorMessage, anchorDate, outputLanguage)
    };
  }
  googleNewsSummaryEl.textContent = newsBundle.summary || "—";
  const mbfcEntry = await lookupMbfcEntry(preparedInput.url || "");

  // AI session unavailable: keep the rule-based scores and surface the reason.
  if (!session) {
    const reason = String(sessionError?.message || "Local AI is unavailable");
    const fallback = buildDeterministicLocalAssessment(preparedInput, newsBundle, mbfcEntry, "", outputLanguage);
    fallback.summary = reason;
    fallback.rationale = reason;
    fallback.missing = [reason];
    fallback.debug_trace = buildDebugTrace({
      stage: "local-session-unavailable",
      outputLanguage,
      modelOutputLanguage,
      prompt: "",
      raw: "",
      parsed: null,
      error: reason,
      newsSummary: newsBundle.summary,
      newsRawPreview: newsBundle.rawPreview,
      mbfc: mbfcEntry
    });
    console.error(`${DEBUG_PREFIX} local AI session unavailable`, { error: reason });
    return fallback;
  }

  const prompt = buildLocalPrompt(preparedInput, newsBundle, mbfcEntry, modelOutputLanguage, outputLanguage);
  let raw = "";
  try {
    raw = await promptLocalAssessment(session, prompt, signal);
  } catch (err) {
    reportError("local AI prompt", err, {
      outputLanguage,
      modelOutputLanguage
    });
    raw = "";
  }
  console.info(`${DEBUG_PREFIX} local AI raw output`, {
    outputLanguage,
    modelOutputLanguage,
    promptPreview: truncateForDebug(prompt, 2500),
    rawPreview: truncateForDebug(raw, 3500)
  });
  const parsed = parseAssessmentJson(raw);
  if (!parsed) {
    const fallback = buildDeterministicLocalAssessment(preparedInput, newsBundle, mbfcEntry, raw, outputLanguage);
    fallback.debug_trace = buildDebugTrace({
      stage: "local-parse-fallback",
      outputLanguage,
      modelOutputLanguage,
      prompt,
      raw,
      parsed: null,
      error: "raw output did not parse as JSON",
      newsSummary: newsBundle.summary,
      newsRawPreview: newsBundle.rawPreview,
      mbfc: mbfcEntry,
      analysisLanguage: preparedInput.analysisLanguage,
      analysisLanguageConfidence: preparedInput.analysisLanguageConfidence,
      inputWasTranslated: Boolean(preparedInput.inputWasTranslated)
    });
    console.error(`${DEBUG_PREFIX} local AI parse fallback`, {
      stack: "",
      debug_trace: fallback.debug_trace,
      promptPreview: truncateForDebug(prompt, 2500),
      rawPreview: truncateForDebug(raw, 3500)
    });
    return fallback;
  }

  const deterministicRuleScores = buildDeterministicRuleScores(preparedInput, newsBundle, mbfcEntry);
  const ruleScores = mergeLocalRuleScores(parsed.rule_scores, deterministicRuleScores);
  const overallScore = averageRuleScores(ruleScores);
  const result = {
    verdict: normalizeVerdict(parsed.verdict || verdictFromScore(overallScore)),
    confidence: overallScore,
    summary: sanitizeModelText(parsed.summary || parsed.rationale || fallbackLanguageText(outputLanguage, "analysisDone")),
    rationale: sanitizeModelText(parsed.rationale || parsed.summary || fallbackLanguageText(outputLanguage, "analysisDone")),
    rule_scores: ruleScores,
    rule_notes: normalizeRuleNotes(parsed.rule_notes),
    evidence: mergeEvidenceLists(normalizeEvidence(parsed.evidence, preparedInput), newsBundle.items, preparedInput),
    conflicts: normalizeList(parsed.conflicts),
    missing: normalizeList(parsed.missing),
    news_query: newsBundle.query || "",
    news_summary: newsBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(newsBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(newsBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(preparedInput, outputLanguage)
  };

  const localizedResult = outputLanguage === "zh"
    ? await localizeAssessmentResult(result, outputLanguage, signal)
    : result;
  console.info(`${DEBUG_PREFIX} local AI success`, {
    outputLanguage,
    modelOutputLanguage,
    verdict: localizedResult.verdict,
    confidence: localizedResult.confidence,
    stack: ""
  });
  return localizedResult;
}

function mergeLocalRuleScores(modelRuleScores, deterministicRuleScores) {
  const modelScores = normalizeRuleScores(modelRuleScores);
  const mergedScores = { ...modelScores };

  for (const ruleName of ["reproducibility", "cross_validation", "detail_richness"]) {
    if (mergedScores[ruleName] === 0 && deterministicRuleScores[ruleName] > 0) {
      mergedScores[ruleName] = deterministicRuleScores[ruleName];
    }
  }

  return mergedScores;
}
