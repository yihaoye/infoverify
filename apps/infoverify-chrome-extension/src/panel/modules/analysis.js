// ---------- Local AI orchestration and scoring pipeline ----------
import { USE_LOCAL_RESPONSE_CONSTRAINT } from "./constants.js";
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
import {
  buildLocalPrompt,
  buildLocalInstructions,
  buildLocalEvidencePrompt,
  buildLocalResponseSchema
} from "./prompt.js";
import {
  buildDeterministicLocalAssessment,
  buildDeterministicRuleScores,
  assessVerdict
} from "./scoring.js";
import { applyStances } from "./stance.js";
import { parseAssessmentJson, extractStreamingAssessment } from "./normalize.js";
import { mergeEvidenceLists } from "./evidence.js";
import {
  buildReproducibilitySummary,
  buildCrossValidationSummary,
  buildSpecificitySummary
} from "./summaries.js";

// Streams the response, passing the accumulated text to `onText` after each
// chunk (chunks are deltas). Also records the time to the first token (prompt
// processing) apart from the time spent generating output.
async function streamPrompt(session, prompt, options, stats, onText) {
  const startedAt = performance.now();
  let text = "";
  for await (const chunk of session.promptStreaming(prompt, options)) {
    if (!text && chunk) stats.firstTokenMs = Math.round(performance.now() - startedAt);
    text += chunk;
    onText?.(text);
  }
  stats.outputChars = text.length;
  return text;
}

// Constrained decoding guarantees parsable JSON. If this Chrome build rejects
// the constraint itself, retry once unconstrained rather than losing the run.
// `stats` receives firstTokenMs / outputChars for the timing line.
export async function promptLocalAssessment(session, prompt, signal, stats = {}, onText) {
  if (!USE_LOCAL_RESPONSE_CONSTRAINT) return await streamPrompt(session, prompt, { signal }, stats, onText);
  try {
    return await streamPrompt(session, prompt, {
      signal,
      responseConstraint: buildLocalResponseSchema(),
      // The prompt already describes the format; don't prepend the schema too.
      omitResponseConstraintInput: true
    }, stats, onText);
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") throw err;
    reportError("local AI constrained prompt", err);
    return await streamPrompt(session, prompt, { signal }, stats, onText);
  }
}

// Sends the fixed analysis instructions to the session ahead of the evidence,
// so the model processes them while Google News is being fetched. Resolves
// false when unsupported or failed; the caller then sends them inline.
function appendInstructions(session, instructions, signal) {
  if (typeof session?.append !== "function") return Promise.resolve(false);
  return session.append([{ role: "user", content: instructions }], { signal }).then(
    () => true,
    (err) => {
      if (!signal?.aborted) reportError("local AI append instructions", err);
      return false;
    }
  );
}

// Wall-clock per pipeline stage, shown under the status line to find the slow step.
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

// `onPreview(result)` receives provisional results while the model is still
// writing: the verdict, scores, and evidence stances are final as soon as the
// model has emitted them, and only the summary keeps growing.
export async function runLocalAnalysis(input, signal, { onPreview } = {}) {
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
  // True when query generation already sent the full claim on this session.
  let claimInContext = false;
  // Started once the search query exists (so it lands after the query turn in
  // the session) and runs alongside the Google News fetch.
  let instructionsAppended = null;
  try {
    newsBundle = await fetchGoogleNewsBundle(preparedInput, signal, outputLanguage, {
      session,
      onQueryReady: (query) => {
        claimInContext = query.claimInContext;
        timer.mark("searchQuery");
        if (session) {
          instructionsAppended = appendInstructions(
            session,
            buildLocalInstructions(modelOutputLanguage, outputLanguage),
            signal
          );
        }
      }
    });
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
  timer.mark("newsFetch");
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
    fallback.timings = timer.report();
    return fallback;
  }

  const promptOptions = { claimInContext };
  const prompt = (instructionsAppended && await instructionsAppended)
    ? buildLocalEvidencePrompt(preparedInput, newsBundle, mbfcEntry, promptOptions)
    : buildLocalPrompt(preparedInput, newsBundle, mbfcEntry, modelOutputLanguage, outputLanguage, promptOptions);

  // Builds the full result from the model's fields. Used for the live preview
  // (partial stream) and for the final parsed output.
  const assembleResult = (fields) => {
    const stancedBundle = { ...newsBundle, items: applyStances(newsBundle.items, fields.stances) };
    const ruleScores = buildDeterministicRuleScores(preparedInput, stancedBundle, mbfcEntry, {
      modelSpecificity: fields.specificity
    });
    const { verdict, confidence } = assessVerdict({
      modelVerdict: fields.verdict,
      ruleScores,
      items: stancedBundle.items
    });
    return {
      verdict,
      confidence,
      summary: sanitizeModelText(fields.summary || ""),
      rationale: "",
      rule_scores: ruleScores,
      rule_notes: null,
      evidence: mergeEvidenceLists([], stancedBundle.items, preparedInput),
      news_query: newsBundle.query || "",
      news_summary: newsBundle.summary,
      reproducibility_summary: buildReproducibilitySummary(stancedBundle, mbfcEntry, outputLanguage),
      cross_validation_summary: buildCrossValidationSummary(stancedBundle, outputLanguage),
      specificity_summary: buildSpecificitySummary(preparedInput, outputLanguage)
    };
  };

  // Chinese output is translated after generation, so the English summary is
  // not streamed there; the verdict and scores still show early.
  const streamSummary = outputLanguage !== "zh";
  let lastPreviewKey = "";
  const handleStreamText = onPreview
    ? (text) => {
        const fields = extractStreamingAssessment(text);
        if (!fields.ready) return;
        const summary = streamSummary ? fields.summary : "";
        const key = `${fields.verdict}|${summary}`;
        if (key === lastPreviewKey) return;
        lastPreviewKey = key;
        onPreview(assembleResult({ ...fields, summary }));
      }
    : undefined;

  let raw = "";
  const modelStats = {};
  try {
    raw = await promptLocalAssessment(session, prompt, signal, modelStats, handleStreamText);
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
    fallback.timings = { ...timer.report(), model: modelStats };
    return fallback;
  }

  const result = assembleResult(parsed);
  if (!result.summary) result.summary = fallbackLanguageText(outputLanguage, "analysisDone");

  const localizedResult = outputLanguage === "zh"
    ? await localizeAssessmentResult(result, outputLanguage, signal)
    : result;
  timer.mark("outputTranslation");
  return { ...localizedResult, timings: { ...timer.report(), model: modelStats } };
}
