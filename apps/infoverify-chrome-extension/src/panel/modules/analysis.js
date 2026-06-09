// ---------- Local AI orchestration and scoring pipeline ----------
import { DEBUG_PREFIX } from "./constants.js";
import { gdeltSummaryEl, thinkingTextEl } from "./dom.js";
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
import { fetchGdeltBundle, extractAnchorDate, summarizeGdeltBundle } from "./gdelt.js";
import { lookupMbfcEntry } from "./mbfc.js";
import { buildLocalPrompt } from "./prompt.js";
import { buildDeterministicLocalAssessment, buildDeterministicRuleScores } from "./scoring.js";
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
  // download — doing it before the slower translation and GDELT steps keeps the
  // click's user gesture valid. The dedicated "Download local AI" button is the
  // primary way to perform the one-time download.
  //
  // A failure here must NOT discard the run: the three rule scores are derived
  // from GDELT / MBFC / specificity, not from the AI verdict, so when the model
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
    thinkingTextEl.textContent = "Analyzing text, searching GDELT news, and generating a local conclusion";
  } catch (err) {
    sessionError = err;
    reportError("createLanguageModelSession", err, { outputLanguage, modelOutputLanguage });
  }

  const preparedInput = await prepareEnglishAnalysisInput(input, signal);

  gdeltSummaryEl.textContent = "Searching GDELT news...";
  let gdeltBundle;
  try {
    gdeltBundle = await fetchGdeltBundle(preparedInput, signal, outputLanguage);
  } catch (err) {
    reportError("fetchGdeltBundle", err, {
      input: { url: preparedInput.url, title: preparedInput.title },
      outputLanguage
    });
    const anchorDate = extractAnchorDate(preparedInput);
    const errorMessage = `GDELT fetch failed: ${String(err?.message || err)}`;
    gdeltBundle = {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage,
      rawPreview: "",
      summary: summarizeGdeltBundle("", [], errorMessage, anchorDate, outputLanguage)
    };
  }
  gdeltSummaryEl.textContent = gdeltBundle.summary || "—";
  const mbfcEntry = await lookupMbfcEntry(preparedInput.url || "");

  // AI session unavailable: keep the rule-based scores and surface the reason.
  if (!session) {
    const reason = String(sessionError?.message || "Local AI is unavailable");
    const fallback = buildDeterministicLocalAssessment(preparedInput, gdeltBundle, mbfcEntry, "", outputLanguage);
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
      gdeltSummary: gdeltBundle.summary,
      gdeltRawPreview: gdeltBundle.rawPreview,
      mbfc: mbfcEntry
    });
    console.error(`${DEBUG_PREFIX} local AI session unavailable`, { error: reason });
    return fallback;
  }

  const prompt = buildLocalPrompt(preparedInput, gdeltBundle, mbfcEntry, modelOutputLanguage, outputLanguage);
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
    const fallback = buildDeterministicLocalAssessment(preparedInput, gdeltBundle, mbfcEntry, raw, outputLanguage);
    fallback.debug_trace = buildDebugTrace({
      stage: "local-parse-fallback",
      outputLanguage,
      modelOutputLanguage,
      prompt,
      raw,
      parsed: null,
      error: "raw output did not parse as JSON",
      gdeltSummary: gdeltBundle.summary,
      gdeltRawPreview: gdeltBundle.rawPreview,
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

  let ruleScores = normalizeRuleScores(parsed.rule_scores);
  // Some local-model responses parse as JSON but omit (or zero out) rule_scores.
  // The scores reflect GDELT/MBFC/specificity, so fall back to the deterministic
  // values rather than showing 0% across the board.
  if (ruleScores.reproducibility === 0 && ruleScores.cross_validation === 0 && ruleScores.detail_richness === 0) {
    ruleScores = buildDeterministicRuleScores(preparedInput, gdeltBundle, mbfcEntry);
  }
  const overallScore = normalizeConfidence(parsed.overall_score ?? averageRuleScores(ruleScores));
  const result = {
    verdict: normalizeVerdict(parsed.verdict || verdictFromScore(overallScore)),
    confidence: overallScore,
    summary: sanitizeModelText(parsed.summary || parsed.rationale || fallbackLanguageText(outputLanguage, "analysisDone")),
    rationale: sanitizeModelText(parsed.rationale || parsed.summary || fallbackLanguageText(outputLanguage, "analysisDone")),
    rule_scores: ruleScores,
    rule_notes: normalizeRuleNotes(parsed.rule_notes),
    evidence: mergeEvidenceLists(normalizeEvidence(parsed.evidence, preparedInput), gdeltBundle.items, preparedInput),
    conflicts: normalizeList(parsed.conflicts),
    missing: normalizeList(parsed.missing),
    gdelt_query: gdeltBundle.query || "",
    gdelt_summary: gdeltBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(gdeltBundle, outputLanguage),
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
