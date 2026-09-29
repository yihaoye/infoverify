// ---------- Local AI orchestration and scoring pipeline ----------
import { DEBUG_PREFIX } from "./constants.js";
import { googleNewsSummaryEl, thinkingTextEl } from "./dom.js";
import { reportError, setStatus } from "./logging.js";
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
import { lookupMbfcEntry, annotateSourceCredibility } from "./mbfc.js";
import { buildLocalPrompt, buildLocalResponseSchema } from "./prompt.js";
import {
  buildDeterministicLocalAssessment,
  buildDeterministicRuleScores,
  assessVerdict
} from "./scoring.js";
import { applyStances } from "./stance.js";
import { normalizeRuleNotes, parseAssessmentJson } from "./normalize.js";
import { mergeEvidenceLists } from "./evidence.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

// Constrained decoding guarantees parsable JSON. If this Chrome build rejects
// the constraint itself, retry once unconstrained rather than losing the run.
export async function promptLocalAssessment(session, prompt, signal) {
  try {
    return await session.prompt(prompt, {
      signal,
      responseConstraint: buildLocalResponseSchema(),
      // The prompt already describes the format; don't prepend the schema too.
      omitResponseConstraintInput: true
    });
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    reportError("local AI constrained prompt", err);
    return await session.prompt(prompt, { signal });
  }
}

// Wall-clock per pipeline stage, logged on every run to find the slow step.
function createStageTimer() {
  const startedAt = performance.now();
  let last = startedAt;
  const stages = {};
  return {
    mark(name) {
      const now = performance.now();
      stages[name] = Math.round(now - last);
      last = now;
    },
    report() {
      return { ...stages, total: Math.round(performance.now() - startedAt) };
    }
  };
}

export async function runLocalAnalysis(input, signal) {
  const outputLanguage = await getPreferredOutputLanguage();
  const modelOutputLanguage = resolveModelOutputLanguage(outputLanguage);
  const timer = createStageTimer();

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
  timer.mark("session");

  const preparedInput = await prepareEnglishAnalysisInput(input, signal);
  timer.mark("inputTranslation");

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
      summary: summarizeGoogleNewsBundle("", [], errorMessage, anchorDate, outputLanguage)
    };
  }
  googleNewsSummaryEl.textContent = newsBundle.summary || "—";
  timer.mark("newsQueryAndFetch");
  const [mbfcEntry, credibleItems] = await Promise.all([
    lookupMbfcEntry(preparedInput.url || ""),
    annotateSourceCredibility(newsBundle.items)
  ]);
  newsBundle = { ...newsBundle, items: credibleItems };

  // AI session unavailable: keep the rule-based scores and surface the reason.
  if (!session) {
    const reason = String(sessionError?.message || "Local AI is unavailable");
    const fallback = buildDeterministicLocalAssessment(preparedInput, newsBundle, mbfcEntry, "", outputLanguage);
    fallback.summary = reason;
    fallback.rationale = reason;
    console.info(`${DEBUG_PREFIX} stage timings (ms)`, timer.report());
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
  timer.mark("modelPrompt");
  session.destroy?.();
  const parsed = parseAssessmentJson(raw);
  if (!parsed) {
    const fallback = buildDeterministicLocalAssessment(preparedInput, newsBundle, mbfcEntry, raw, outputLanguage);
    // An empty `raw` was already reported by the prompt failure above.
    if (raw) {
      reportError("local AI parse fallback", new Error("model output did not parse as JSON"), {
        rawPreview: String(raw).slice(0, 500)
      });
    }
    console.info(`${DEBUG_PREFIX} stage timings (ms)`, timer.report());
    return fallback;
  }

  const stancedBundle = { ...newsBundle, items: applyStances(newsBundle.items, parsed.stances) };
  const ruleScores = buildDeterministicRuleScores(preparedInput, stancedBundle, mbfcEntry, {
    modelSpecificity: parsed.specificity
  });
  const { verdict, confidence } = assessVerdict({
    modelVerdict: parsed.verdict,
    ruleScores,
    items: stancedBundle.items
  });
  const result = {
    verdict,
    confidence,
    summary: sanitizeModelText(parsed.summary || parsed.rationale || fallbackLanguageText(outputLanguage, "analysisDone")),
    rationale: sanitizeModelText(parsed.rationale || parsed.summary || fallbackLanguageText(outputLanguage, "analysisDone")),
    rule_scores: ruleScores,
    rule_notes: normalizeRuleNotes(parsed.rule_notes),
    evidence: mergeEvidenceLists([], stancedBundle.items, preparedInput),
    news_query: newsBundle.query || "",
    news_summary: newsBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(stancedBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(stancedBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(preparedInput, outputLanguage)
  };

  const localizedResult = outputLanguage === "zh"
    ? await localizeAssessmentResult(result, outputLanguage, signal)
    : result;
  timer.mark("outputTranslation");
  console.info(`${DEBUG_PREFIX} stage timings (ms)`, timer.report());
  return localizedResult;
}
