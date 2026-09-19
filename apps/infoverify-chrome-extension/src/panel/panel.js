const statusEl = document.getElementById("status");
const thinkingBannerEl = document.getElementById("thinkingBanner");
const thinkingTextEl = document.getElementById("thinkingText");
const verdictPillEl = document.getElementById("verdictPill");
const confidenceEl = document.getElementById("confidence");
const summaryEl = document.getElementById("summary");
const reproScoreEl = document.getElementById("reproScore");
const crossScoreEl = document.getElementById("crossScore");
const detailScoreEl = document.getElementById("detailScore");
const reproSummaryEl = document.getElementById("reproSummary");
const reproNoteEl = document.getElementById("reproNote");
const crossSummaryEl = document.getElementById("crossSummary");
const crossNoteEl = document.getElementById("crossNote");
const detailSummaryEl = document.getElementById("detailSummary");
const detailNoteEl = document.getElementById("detailNote");
const evidenceEl = document.getElementById("evidence");
const newsSummaryEl = document.getElementById("newsSummary");
const llmVerdictPillEl = document.getElementById("llmVerdictPill");
const llmConfidenceEl = document.getElementById("llmConfidence");
const llmRationaleEl = document.getElementById("llmRationale");
const debugCardEl = document.getElementById("debugCard");
const debugTraceEl = document.getElementById("debugTrace");
const debugStatusEl = document.getElementById("debugStatus");
const debugCopyButtonEl = document.getElementById("debugCopyButton");
const modePillEl = document.getElementById("modePill");
const localModeButtonEl = document.getElementById("localModeButton");
const cloudModeButtonEl = document.getElementById("cloudModeButton");

let currentVerification = null;
let loadingStartAt = 0;
let loadingHideTimer = 0;
let activeRun = { id: "", mode: "", controller: null };
let newsRequestChain = Promise.resolve();
let newsLastRequestAt = 0;
let mbfcDatasetPromise = null;
let newsCooldownUntil = 0;
let lastDebugTrace = "";
const DEBUG_PREFIX = "[InfoVerify]";
const minLoadingMs = 700;
const newsMinIntervalMs = 5200;
const newsCacheTtlMs = 15 * 60 * 1000;
const newsCooldownMs = 2 * 60 * 1000;
const SUPPORTED_OUTPUT_LANGUAGES = new Set(["en", "es", "ja", "zh"]);
const SUPPORTED_MODEL_OUTPUT_LANGUAGES = new Set(["en", "es", "ja"]);
const OUTPUT_LANGUAGE_LABELS = {
  en: "English",
  es: "Spanish",
  ja: "Japanese",
  zh: "Chinese"
};
const FALLBACK_TEXT = {
  en: {
    jsonFallback: "The local AI response could not be parsed as JSON, so deterministic scoring was used.",
    noOutput: "The local AI returned no parsable output.",
    analysisDone: "Local AI analysis completed."
  },
  es: {
    jsonFallback: "La respuesta de la IA local no se pudo analizar como JSON, así que se usó una puntuación determinista.",
    noOutput: "La IA local no devolvió una salida que se pudiera analizar.",
    analysisDone: "El análisis de la IA local se completó."
  },
  ja: {
    jsonFallback: "ローカル AI の応答を JSON として解析できなかったため、決定論的なスコアリングを使用しました。",
    noOutput: "ローカル AI から解析可能な出力が返されませんでした。",
    analysisDone: "ローカル AI の分析が完了しました。"
  },
  zh: {
    jsonFallback: "由于本地 AI 的响应无法解析为 JSON，因此改用确定性评分。",
    noOutput: "本地 AI 没有返回可解析的输出。",
    analysisDone: "本地 AI 分析已完成。"
  }
};



// ---------- UI events, logging, and shared panel state ----------
localModeButtonEl.addEventListener("click", () => {
  void requestRun();
});

debugCopyButtonEl.addEventListener("click", () => {
  if (!lastDebugTrace) return;
  void navigator.clipboard?.writeText?.(lastDebugTrace).then(() => {
    debugStatusEl.textContent = "Copied to clipboard";
    window.setTimeout(() => {
      if (debugStatusEl.textContent === "Copied to clipboard") {
        debugStatusEl.textContent = "—";
      }
    }, 1500);
  }).catch(() => {
    debugStatusEl.textContent = "Copy failed, please select and copy manually";
  });
});

window.addEventListener("error", (event) => {
  console.error(`${DEBUG_PREFIX} window error`, {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack || "",
    error: event.error || null
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(`${DEBUG_PREFIX} unhandled rejection`, {
    reason: event.reason,
    stack: event.reason?.stack || ""
  });
});

function reportError(stage, error, context = {}) {
  const message = error?.message || String(error || "Unknown error");
  console.error(`${DEBUG_PREFIX} ${stage}`, {
    message,
    stack: error?.stack || "",
    context,
    error
  });
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

async function getPreferredOutputLanguage() {
  const { outputLanguage = "auto" } = await chrome.storage.sync.get({
    outputLanguage: "auto"
  });
  return resolveOutputLanguage(outputLanguage);
}

function resolveOutputLanguage(value) {
  const normalized = String(value || "").toLowerCase();
  if (SUPPORTED_OUTPUT_LANGUAGES.has(normalized)) return normalized;
  const detected = String(navigator.language || navigator.languages?.[0] || "en").toLowerCase();
  if (detected.startsWith("zh")) return "zh";
  if (detected.startsWith("es")) return "es";
  if (detected.startsWith("ja")) return "ja";
  return "en";
}

function resolveModelOutputLanguage(value) {
  const language = resolveOutputLanguage(value);
  if (SUPPORTED_MODEL_OUTPUT_LANGUAGES.has(language)) return language;
  return "en";
}

function getLanguageLabel(value) {
  return OUTPUT_LANGUAGE_LABELS[resolveOutputLanguage(value)] || "English";
}

function fallbackLanguageText(value, key) {
  const language = resolveOutputLanguage(value);
  return FALLBACK_TEXT[language]?.[key] || FALLBACK_TEXT.en[key] || "";
}

function truncateForDebug(value, maxChars = 6000) {
  const text = String(value || "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

function buildDebugTrace(fields) {
  return JSON.stringify(
    {
      stage: fields.stage || "unknown",
      outputLanguage: fields.outputLanguage || "en",
      modelOutputLanguage: fields.modelOutputLanguage || "en",
      promptPreview: truncateForDebug(fields.prompt, 2500),
      rawPreview: truncateForDebug(fields.raw, 3500),
      parsedPreview: fields.parsed || null,
      error: fields.error || "",
      newsSummary: truncateForDebug(fields.newsSummary, 1200),
      newsRawPreview: truncateForDebug(fields.newsRawPreview, 1200),
      mbfc: fields.mbfc || null
    },
    null,
    2
  );
}

function setDebugTrace(trace) {
  lastDebugTrace = String(trace || "");
  if (!lastDebugTrace) {
    debugCardEl.hidden = true;
    debugTraceEl.textContent = "";
    debugStatusEl.textContent = "—";
    return;
  }

  debugCardEl.hidden = false;
  debugTraceEl.textContent = lastDebugTrace;
  debugStatusEl.textContent = "Copy this and paste it here for troubleshooting";
}



// ---------- Language detection and translation ----------
let languageDetectorCache = null;

async function detectLanguage(text, signal) {
  const sample = String(text || "").trim();
  if (!sample || sample.length < 20) {
    return { language: "unknown", confidence: 0, results: [] };
  }

  const api = globalThis.LanguageDetector;
  if (!api) return { language: "unknown", confidence: 0, results: [] };

  try {
    const availability = await api.availability();
    if (availability === "unavailable") return { language: "unknown", confidence: 0, results: [] };

    if (!languageDetectorCache) {
      languageDetectorCache = await api.create();
    }

    const results = await languageDetectorCache.detect(sample);
    if (!Array.isArray(results) || results.length === 0) {
      return { language: "unknown", confidence: 0, results: [] };
    }

    const [top] = results;
    return {
      language: String(top?.detectedLanguage || "unknown"),
      confidence: Number(top?.confidence || 0),
      results
    };
  } catch {
    return { language: "unknown", confidence: 0, results: [] };
  }
}

let translatorCache = new Map();

async function getTranslator(sourceLanguage, targetLanguage, signal) {
  const key = `${sourceLanguage}->${targetLanguage}`;
  if (translatorCache.has(key)) return translatorCache.get(key);

  const api = globalThis.Translator;
  if (!api) return null;

  try {
    const availability = await api.availability({ sourceLanguage, targetLanguage });
    if (availability === "unavailable") return null;

    const translator = await api.create({
      sourceLanguage,
      targetLanguage
    });
    translatorCache.set(key, translator);
    return translator;
  } catch {
    return null;
  }
}

async function translateText(value, sourceLanguage, targetLanguage, signal) {
  const text = String(value || "");
  if (!text) return text;
  if (sourceLanguage === targetLanguage) return text;

  const translator = await getTranslator(sourceLanguage, targetLanguage, signal);
  if (!translator) return text;

  try {
    return await translator.translate(text);
  } catch {
    return text;
  }
}

async function prepareEnglishAnalysisInput(input, signal) {
  const selectionText = String(input?.selectionText || "");
  const title = String(input?.title || "");
  const pageText = String(input?.pageText || "");
  const sampleText = [selectionText, title, pageText].filter(Boolean).join(" ").slice(0, 2400);

  const detected = await detectLanguage(sampleText, signal);
  const detectedLanguage = String(detected.language || "unknown").toLowerCase();
  // TODO: Tune this threshold after we have a few real-world examples.
  const needsTranslation = detectedLanguage !== "unknown" && detectedLanguage !== "en" && detected.confidence >= 0.45;

  if (!needsTranslation) {
    return {
      ...input,
      analysisLanguage: detectedLanguage,
      analysisLanguageConfidence: detected.confidence,
      analysisText: String(input?.analysisText || input?.pageText || input?.selectionText || ""),
      sourceSelectionText: selectionText,
      sourceTitle: title,
      sourcePageText: pageText
    };
  }

  const translatedSelectionText = await translateText(selectionText, detectedLanguage, "en", signal);
  const translatedTitle = await translateText(title, detectedLanguage, "en", signal);
  const translatedPageText = await translateText(pageText, detectedLanguage, "en", signal);
  const translatedAnalysisText = String(translatedPageText || translatedSelectionText || translatedTitle || input?.analysisText || input?.pageText || input?.selectionText || "");

  return {
    ...input,
    selectionText: translatedSelectionText || selectionText,
    title: translatedTitle || title,
    pageText: translatedPageText || pageText,
    analysisText: translatedAnalysisText,
    analysisLanguage: detectedLanguage,
    analysisLanguageConfidence: detected.confidence,
    sourceSelectionText: selectionText,
    sourceTitle: title,
    sourcePageText: pageText,
    inputWasTranslated: true
  };
}

async function translateArray(values, sourceLanguage, targetLanguage, signal) {
  if (!Array.isArray(values) || values.length === 0) return Array.isArray(values) ? [] : [];
  const translated = [];
  for (const value of values) {
    translated.push(await shouldTranslateText(value, sourceLanguage, targetLanguage, signal));
  }
  return translated;
}

async function localizeAssessmentResult(result, targetLanguage, signal) {
  if (!result || targetLanguage !== "zh") return result;
  const sourceLanguage = "en";
  const localized = {
    ...result,
    summary: await shouldTranslateText(result.summary, sourceLanguage, targetLanguage, signal),
    rationale: await shouldTranslateText(result.rationale, sourceLanguage, targetLanguage, signal),
    news_summary: await shouldTranslateText(result.news_summary, sourceLanguage, targetLanguage, signal),
    reproducibility_summary: await shouldTranslateText(result.reproducibility_summary, sourceLanguage, targetLanguage, signal),
    cross_validation_summary: await shouldTranslateText(result.cross_validation_summary, sourceLanguage, targetLanguage, signal),
    specificity_summary: await shouldTranslateText(result.specificity_summary, sourceLanguage, targetLanguage, signal),
    conflicts: await translateArray(result.conflicts, sourceLanguage, targetLanguage, signal),
    missing: await translateArray(result.missing, sourceLanguage, targetLanguage, signal),
    evidence: Array.isArray(result.evidence)
      ? await Promise.all(result.evidence.map(async (item) => ({
          ...item,
          title: await shouldTranslateText(item?.title, sourceLanguage, targetLanguage, signal),
          quote: await shouldTranslateText(item?.quote, sourceLanguage, targetLanguage, signal)
        })))
      : result.evidence
  };

  if (localized.rule_notes) {
    localized.rule_notes = {
      reproducibility: await shouldTranslateText(result.rule_notes?.reproducibility || "", sourceLanguage, targetLanguage, signal),
      cross_validation: await shouldTranslateText(result.rule_notes?.cross_validation || "", sourceLanguage, targetLanguage, signal),
      detail_richness: await shouldTranslateText(result.rule_notes?.detail_richness || "", sourceLanguage, targetLanguage, signal)
    };
  }

  if (localized.llm_assessment) {
    localized.llm_assessment = {
      ...result.llm_assessment,
      rationale: await shouldTranslateText(result.llm_assessment?.rationale || "", sourceLanguage, targetLanguage, signal),
      summary: await shouldTranslateText(result.llm_assessment?.summary || "", sourceLanguage, targetLanguage, signal),
      error: await shouldTranslateText(result.llm_assessment?.error || "", sourceLanguage, targetLanguage, signal)
    };
  }

  return localized;
}



// ---------- Panel state, loading state, and result rendering ----------
function updateModeButtons() {
  localModeButtonEl.classList.toggle("active", true);
  if (cloudModeButtonEl) {
    cloudModeButtonEl.classList.toggle("active", false);
  }
  modePillEl.textContent = "Local AI";
}

function setLoading(loading) {
  if (loading) {
    if (loadingHideTimer) {
      window.clearTimeout(loadingHideTimer);
      loadingHideTimer = 0;
    }
    loadingStartAt = performance.now();
    thinkingBannerEl.classList.add("active");
    if (statusEl) {
      statusEl.classList.add("thinking");
      setStatus("Calling local AI...");
    }
    thinkingTextEl.textContent = "Analyzing text, searching Google News, and generating a local conclusion";
    updateModeButtons();
    return;
  }

  const elapsed = performance.now() - loadingStartAt;
  const remaining = Math.max(0, minLoadingMs - elapsed);
  loadingHideTimer = window.setTimeout(() => {
    thinkingBannerEl.classList.remove("active");
    if (statusEl) {
      statusEl.classList.remove("thinking");
    }
    thinkingTextEl.textContent = "Done";
    loadingHideTimer = 0;
  }, remaining);
}

async function hydrateInitialState() {
  const { currentVerification: stored } = await chrome.storage.session.get({
    currentVerification: null
  });

  if (!stored) {
    updateModeButtons();
    return;
  }

  currentVerification = {
    ...stored,
    mode: "local"
  };
  updateModeButtons();

  if (stored.state === "loading" && stored.input) {
    await startVerification({ ...stored, mode: "local" }, { allowDownload: true });
    return;
  }

  if (stored.state === "done" && stored.result) {
    renderVerification({ ...stored.result, mode: "local" });
  }
}

async function requestRun() {
  const input = currentVerification?.input;
  if (!input) return;

  const runId = crypto.randomUUID();
  const verification = {
    state: "loading",
    mode: "local",
    runId,
    input,
    startedAt: Date.now()
  };

  await chrome.storage.session.set({ currentVerification: verification });
  currentVerification = verification;
  await startVerification(verification, { allowDownload: true });
}

async function startVerification(verification, { allowDownload = false } = {}) {
  if (!verification?.input) return;
  if (activeRun.id && activeRun.id === verification.runId) return;

  if (activeRun.controller) {
    activeRun.controller.abort();
  }

  const controller = new AbortController();
  activeRun = {
    id: verification.runId || crypto.randomUUID(),
    mode: "local",
    controller
  };

  currentVerification = {
    ...verification,
    runId: activeRun.id,
    mode: "local"
  };
  await chrome.storage.session.set({ currentVerification });

  setLoading(true);
  setVerdict("—");
  summaryEl.textContent = "—";
  renderRuleScores(null, null);
  renderEvidence([]);
  newsSummaryEl.textContent = "—";
  setLLMAssessment(null);
  setDebugTrace("");

  try {
    const payload = await runLocalAnalysis(currentVerification.input, controller.signal, {
      allowDownload
    });

    if (controller.signal.aborted || activeRun.id !== currentVerification.runId) return;

    const result = normalizeResult(payload, activeRun.mode, currentVerification.input);
    currentVerification = {
      ...currentVerification,
      state: "done",
      finishedAt: Date.now(),
      result
    };
    await chrome.storage.session.set({ currentVerification });
    renderVerification(result);
  } catch (err) {
    if (controller.signal.aborted || activeRun.id !== currentVerification.runId) return;

    reportError("startVerification catch", err, {
      input: currentVerification.input,
      mode: activeRun.mode
    });

    const result = errorResult({
      input: currentVerification.input,
      mode: activeRun.mode,
      message: formatError(err)
    });
    currentVerification = {
      ...currentVerification,
      state: "done",
      finishedAt: Date.now(),
      result
    };
    await chrome.storage.session.set({ currentVerification });
    renderVerification(result);
  }
}

function renderVerification(payload) {
  updateModeButtons();
  setLoading(false);
  setStatus("Done");
  setVerdict(payload.verdict, payload.confidence);
  summaryEl.textContent = payload.summary || "—";
  renderRuleScores(payload.rule_scores || null, payload.rule_notes || null, {
    specificity: payload.specificity_summary || "",
    cross_validation: payload.cross_validation_summary || "",
    reproducibility: payload.reproducibility_summary || ""
  });
  renderEvidence(payload.evidence);
  newsSummaryEl.textContent = payload.news_summary || "—";
  setLLMAssessment(payload.llm_assessment || null);
  setDebugTrace(payload.debug_trace || payload.llm_assessment?.debug_trace || "");
}

function renderRuleScores(ruleScores, ruleNotes, extraContext = {}) {
  const scores = normalizeRuleScores(ruleScores);
  reproScoreEl.textContent = formatScore(scores.reproducibility);
  crossScoreEl.textContent = formatScore(scores.cross_validation);
  detailScoreEl.textContent = formatScore(scores.detail_richness);

  reproSummaryEl.textContent = extraContext.reproducibility || "—";
  crossSummaryEl.textContent = extraContext.cross_validation || "—";
  detailSummaryEl.textContent = extraContext.specificity || "—";

  reproNoteEl.textContent = ruleNotes?.reproducibility || "—";
  crossNoteEl.textContent = ruleNotes?.cross_validation || "—";
  detailNoteEl.textContent = ruleNotes?.detail_richness || "—";
}

function setVerdict(verdict, confidence) {
  verdictPillEl.className = "pill";
  verdictPillEl.textContent = verdict || "—";
  if (verdict === "supported") verdictPillEl.classList.add("good");
  else if (verdict === "contradicted") verdictPillEl.classList.add("bad");
  else if (verdict === "unclear") verdictPillEl.classList.add("warn");

  confidenceEl.textContent =
    typeof confidence === "number" ? `Confidence ${(confidence * 100).toFixed(0)}%` : "—";
}

function setLLMAssessment(assess) {
  llmVerdictPillEl.className = "pill";
  llmVerdictPillEl.textContent = assess?.verdict || "—";
  const verdict = assess?.verdict;
  if (verdict === "high") llmVerdictPillEl.classList.add("good");
  else if (verdict === "low") llmVerdictPillEl.classList.add("bad");
  else if (verdict === "medium" || verdict === "unclear") llmVerdictPillEl.classList.add("warn");

  llmConfidenceEl.textContent =
    typeof assess?.confidence === "number" ? `Confidence ${(assess.confidence * 100).toFixed(0)}%` : "—";

  if (assess?.error) llmRationaleEl.textContent = `Unavailable: ${assess.error}`;
  else llmRationaleEl.textContent = assess?.rationale || assess?.summary || "—";
}

function renderEvidence(evidence) {
  evidenceEl.innerHTML = "";
  if (!Array.isArray(evidence) || evidence.length === 0) {
    evidenceEl.textContent = "—";
    return;
  }

  for (const item of evidence) {
    const wrap = document.createElement("div");
    wrap.className = "evidenceItem";

    const title = document.createElement("div");
    title.className = "evidenceTitle";
    const a = document.createElement("a");
    a.href = item.url || "#";
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = item.title || item.url || "Evidence";
    title.appendChild(a);

    const quote = document.createElement("div");
    quote.className = "evidenceQuote";
    quote.textContent = item.quote || "";

    wrap.appendChild(title);
    wrap.appendChild(quote);
    evidenceEl.appendChild(wrap);
  }
}



// ---------- Local AI orchestration and scoring pipeline ----------
async function runLocalAnalysis(input, signal, { allowDownload = false } = {}) {
  const api = globalThis.LanguageModel;
  if (!api) {
    throw new Error("Chrome built-in AI is unavailable; please try again later");
  }

  const outputLanguage = await getPreferredOutputLanguage();
  const modelOutputLanguage = resolveModelOutputLanguage(outputLanguage);
  const preparedInput = await prepareEnglishAnalysisInput(input, signal);

  const availability = await api.availability({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: [modelOutputLanguage] }]
  });

  if (availability !== "available" && !allowDownload) {
    throw new Error("Chrome local AI must be ready first; please click the Local AI button and try again");
  }

  newsSummaryEl.textContent = "Searching Google News...";
  let newsBundle;
  try {
    newsBundle = await fetchNewsBundle(preparedInput, signal, outputLanguage);
  } catch (err) {
    reportError("fetchNewsBundle", err, {
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
      summary: summarizeNewsBundle("", [], errorMessage, anchorDate, outputLanguage)
    };
  }
  newsSummaryEl.textContent = newsBundle.summary || "—";
  const mbfcEntry = await lookupMbfcEntry(preparedInput.url || "");
  let session;
  try {
    session = await api.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: [modelOutputLanguage] }],
      signal
    });
  } catch (err) {
    throw new Error(`Local AI session creation failed: ${String(err?.message || err)}`);
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

  const ruleScores = normalizeRuleScores(parsed.rule_scores);
  const overallScore = normalizeConfidence(parsed.overall_score ?? averageRuleScores(ruleScores));
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

// ---------- Deterministic fallback assessment when model output cannot be parsed ----------
function buildDeterministicLocalAssessment(input, newsBundle, mbfcEntry, raw, outputLanguage) {
  const rule_scores = buildDeterministicRuleScores(input, newsBundle, mbfcEntry);
  const confidence = normalizeConfidence(averageRuleScores(rule_scores));
  const rationale = sanitizeModelText(raw) || fallbackLanguageText(outputLanguage, "noOutput");
  return {
    verdict: normalizeVerdict(verdictFromScore(confidence)),
    confidence,
    summary: rationale,
    rationale,
    rule_scores,
    rule_notes: {
      reproducibility: buildReproducibilitySummary(newsBundle, mbfcEntry, outputLanguage),
      cross_validation: buildCrossValidationSummary(newsBundle, outputLanguage),
      detail_richness: buildSpecificitySummary(input, outputLanguage)
    },
    evidence: mergeEvidenceLists(buildFallbackEvidence(input), newsBundle.items, input),
    conflicts: [],
    missing: raw ? [fallbackLanguageText(outputLanguage, "jsonFallback")] : [fallbackLanguageText(outputLanguage, "noOutput")],
    news_summary: newsBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(newsBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(newsBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };
}

// ---------- Rule scoring helpers used by both model and fallback paths ----------
function buildDeterministicRuleScores(input, newsBundle, mbfcEntry) {
  return {
    reproducibility: scoreReproducibility(newsBundle, mbfcEntry),
    cross_validation: scoreCrossValidation(newsBundle),
    detail_richness: scoreSpecificity(input)
  };
}

function scoreSpecificity(input) {
  const text = getAnalysisText(input) || `${input?.selectionText || ""} ${input?.pageText || ""}`;
  const normalized = String(text || "");
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const numbers = (normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const dates = (normalized.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{4}年\d{1,2}月\d{1,2}日)|(?:\d{1,2}\/\d{1,2}\/\d{4})/g) || []).length;
  const hasSpecificMarkers = /(?:%|\$|\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b)/.test(normalized);
  const score = 0.16 + Math.min(0.34, words / 220) + Math.min(0.2, numbers * 0.05) + Math.min(0.14, dates * 0.06) + (hasSpecificMarkers ? 0.08 : 0);
  return clamp(score, 0, 1);
}

function scoreCrossValidation(newsBundle) {
  const items = Array.isArray(newsBundle?.items) ? newsBundle.items : [];
  if (items.length === 0) return 0.12;

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const dates = countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== "未知"));
  const score = 0.2 +
    Math.min(0.25, items.length * 0.05) +
    Math.min(0.3, Math.max(0, domains - 1) * 0.1) +
    Math.min(0.25, Math.max(0, dates - 1) * 0.08);
  return clamp(score, 0, 1);
}

function scoreReproducibility(newsBundle, mbfcEntry) {
  const items = Array.isArray(newsBundle?.items) ? newsBundle.items : [];
  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const dates = countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== "未知"));
  const hasMbfc = Boolean(mbfcEntry);
  const score = 0.2 +
    (hasMbfc ? 0.22 : 0) +
    Math.min(0.18, items.length * 0.03) +
    Math.min(0.18, Math.max(0, domains - 1) * 0.08) +
    Math.min(0.14, Math.max(0, dates - 1) * 0.07);
  return clamp(score, 0, 1);
}

// ---------- Normalization of model output and error handling ----------
function normalizeResult(payload, mode, input) {
  const result = {
    verdict: normalizeVerdict(payload?.verdict),
    confidence: normalizeConfidence(payload?.confidence),
    summary: String(payload?.summary || payload?.rationale || "—"),
    rationale: String(payload?.rationale || payload?.summary || "—"),
    rule_scores: normalizeRuleScores(payload?.rule_scores),
    rule_notes: normalizeRuleNotes(payload?.rule_notes),
    evidence: normalizeEvidence(payload?.evidence, input),
    conflicts: normalizeList(payload?.conflicts),
    missing: normalizeList(payload?.missing),
    llm_assessment: payload?.llm_assessment || null,
    debug_trace: String(payload?.debug_trace || ""),
    mode,
    news_summary: String(payload?.news_summary || ""),
    reproducibility_summary: String(payload?.reproducibility_summary || ""),
    cross_validation_summary: String(payload?.cross_validation_summary || ""),
    specificity_summary: String(payload?.specificity_summary || "")
  };

  if (!result.llm_assessment && mode === "local") {
    result.llm_assessment = {
      verdict: result.verdict === "supported" ? "high" : result.verdict === "contradicted" ? "low" : "unclear",
      confidence: result.confidence,
      rationale: result.rationale,
      summary: result.summary
    };
  }

  return result;
}

function errorResult({ input, mode, message }) {
  return {
    verdict: "unclear",
    summary: message,
    rationale: message,
    confidence: 0,
    evidence: [
      {
        title: input.title || "Current page",
        url: input.url || "",
        quote: input.selectionText || input.pageText?.slice(0, 160) || "",
        retrieved_at: input.capturedAt || new Date().toISOString(),
        source_type: "page"
      }
    ],
    conflicts: [],
    missing: [message],
    llm_assessment: {
      verdict: "unclear",
      confidence: 0,
      rationale: message,
      error: message
    },
    debug_trace: buildDebugTrace({
      stage: "error",
      error: message,
      prompt: "",
      raw: "",
      parsed: null
    }),
    mode,
    news_summary: ""
  };
}

// ---------- Prompt construction and output schema for the local model ----------
function buildLocalPrompt(input, newsBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en") {
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
    "2) Cross-validation: judge whether independent sources support the claim. Focus on distinct domains, source spread, and consistency with basic scientific knowledge.",
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

// ---------- Input analysis, MBFC lookup, and model repair helpers ----------
function getAnalysisText(input) {
  const analysisText = String(input?.analysisText || "").trim();
  if (analysisText) return analysisText;
  const selection = String(input?.selectionText || "").trim();
  if (selection) return selection;
  return String(input?.pageText || "").trim();
}

async function lookupMbfcEntry(url) {
  const hostname = normalizeHostname(url);
  if (!hostname) return null;

  const dataset = await loadMbfcDataset();
  if (!dataset) return null;

  const entries = Array.isArray(dataset)
    ? dataset
    : Array.isArray(dataset?.domains)
      ? dataset.domains
      : dataset?.domains && typeof dataset.domains === "object"
        ? Object.entries(dataset.domains).map(([domain, value]) => ({ domain, ...value }))
        : [];

  const candidates = buildHostnameCandidates(hostname);
  for (const candidate of candidates) {
    const match = entries.find((entry) => normalizeHostname(entry?.domain || entry?.url || entry?.site || "") === candidate);
    if (match) {
      return normalizeMbfcEntry(match, candidate);
    }
  }

  return null;
}

async function promptLocalAssessment(session, prompt, signal) {
  return await session.prompt(prompt, { signal });
}

async function loadMbfcDataset() {
  if (!mbfcDatasetPromise) {
    mbfcDatasetPromise = fetch(chrome.runtime.getURL("src/data/mbfc.json"))
      .then((resp) => (resp.ok ? resp.json() : null))
      .catch(() => null);
  }
  return mbfcDatasetPromise;
}

function normalizeMbfcEntry(entry, hostname) {
  if (!entry || typeof entry !== "object") return null;
  const rating = String(entry.rating || entry.score || entry.bias || entry.classification || "").trim();
  const label = String(entry.label || entry.name || entry.title || hostname || "").trim();
  const url = String(entry.url || entry.site || hostname || "").trim();
  return {
    hostname,
    label,
    url,
    rating,
    notes: String(entry.notes || entry.summary || "").trim()
  };
}

// ---------- Summary builders for reproducibility, cross-validation, and specificity ----------
function buildReproducibilitySummary(newsBundle, mbfcEntry, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      mbfc: "MBFC",
      noMatch: "no static match or the domain has not been packaged yet.",
      timeline: "Google News timeline",
      first: "first",
      recent: "recent",
      distinct: "distinct domains",
      noData: "no usable news events found.",
      cue: "Assessment cue: reproducibility is stronger when the source is stable over time, repeats across events, and has better domain reputation."
    },
    es: {
      mbfc: "MBFC",
      noMatch: "no hay coincidencia estática o el dominio aún no se ha empaquetado.",
      timeline: "Cronología de Google News",
      first: "primera",
      recent: "reciente",
      distinct: "dominios distintos",
      noData: "no se encontraron eventos de noticias utilizables.",
      cue: "Pista de evaluación: la reproducibilidad es mayor cuando la fuente es estable en el tiempo, se repite entre eventos y tiene mejor reputación de dominio."
    },
    ja: {
      mbfc: "MBFC",
      noMatch: "静的な一致がないか、まだそのドメインがパッケージ化されていません。",
      timeline: "Google News タイムライン",
      first: "最初",
      recent: "最近",
      distinct: "異なるドメイン",
      noData: "利用できるニュースイベントは見つかりませんでした。",
      cue: "評価の目安: 情報源が時間的に安定し、複数のイベントで繰り返され、ドメイン評価が高いほど再現性は高くなります。"
    },
    zh: {
      mbfc: "MBFC",
      noMatch: "没有静态匹配，或者该域名尚未打包。",
      timeline: "Google News 时间线",
      first: "首次",
      recent: "最近",
      distinct: "个独立域名",
      noData: "未找到可用新闻事件。",
      cue: "评估提示：如果信源在时间上稳定、反复出现且域名信誉较好，可复现性更高。"
    }
  }[language] || {
    mbfc: "MBFC",
    noMatch: "no static match or the domain has not been packaged yet.",
    timeline: "Google News timeline",
    first: "first",
    recent: "recent",
    distinct: "distinct domains",
    noData: "no usable news events found.",
    cue: "Assessment cue: reproducibility is stronger when the source is stable over time, repeats across events, and has better domain reputation."
  };
  const lines = [];
  if (mbfcEntry) {
    lines.push(`${copy.mbfc}: ${mbfcEntry.hostname}${mbfcEntry.rating ? ` · ${mbfcEntry.rating}` : ""}${mbfcEntry.label ? ` · ${mbfcEntry.label}` : ""}`);
  } else {
    lines.push(`${copy.mbfc}: ${copy.noMatch}`);
  }

  if (newsBundle?.items?.length) {
    const firstDate = newsBundle.items[newsBundle.items.length - 1]?.retrieved_at || "";
    const lastDate = newsBundle.items[0]?.retrieved_at || "";
    const domains = countDistinctValues(newsBundle.items.map((item) => item.domain).filter(Boolean));
    lines.push(`${copy.timeline}: ${copy.first} ${formatDateOnly(firstDate)} · ${copy.recent} ${formatDateOnly(lastDate)} · ${copy.distinct} ${domains}`);
  } else {
    lines.push(`${copy.timeline}: ${copy.noData}`);
  }

  lines.push(copy.cue);
  return lines.join("\n");
}

function buildCrossValidationSummary(newsBundle, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      empty: "Google News cross-validation: no usable news results, so independent corroboration is weak.",
      prefix: "Google News cross-validation",
      hitsLabel: "hits",
      domainsLabel: "distinct domains",
      span: "Time span",
      cue: "Assessment cue: cross-validation is stronger when multiple independent publisher domains report the claim over time."
    },
    es: {
      empty: "Validación cruzada de Google News: no hay resultados utilizables, por lo que la corroboración independiente es débil.",
      prefix: "Validación cruzada de Google News",
      hitsLabel: "coincidencias",
      domainsLabel: "dominios distintos",
      span: "Intervalo de tiempo",
      cue: "Pista de evaluación: la validación cruzada es más fuerte cuando varios dominios editoriales independientes informan sobre la afirmación a lo largo del tiempo."
    },
    ja: {
      empty: "Google News のクロス検証: 利用できるニュース結果がなく、独立した裏付けは弱いです。",
      prefix: "Google News のクロス検証",
      hitsLabel: "件のヒット",
      domainsLabel: "異なるドメイン",
      span: "期間",
      cue: "評価の目安: 複数の独立した出版社ドメインが時間を通じて主張を報じるほど、クロス検証は強くなります。"
    },
    zh: {
      empty: "Google News 交叉验证：没有可用新闻结果，因此独立印证较弱。",
      prefix: "Google News 交叉验证",
      hitsLabel: "条命中",
      domainsLabel: "个独立域名",
      span: "时间范围",
      cue: "评估提示：当多个独立发布者域名在一段时间内报道同一主张时，交叉验证更强。"
    }
  }[language] || {
    empty: "Google News cross-validation: no usable news results, so independent corroboration is weak.",
    prefix: "Google News cross-validation",
    hitsLabel: "hits",
    domainsLabel: "distinct domains",
    span: "Time span",
    cue: "Assessment cue: cross-validation is stronger when multiple independent publisher domains report the claim over time."
  };
  const items = Array.isArray(newsBundle?.items) ? newsBundle.items : [];
  if (items.length === 0) {
    return copy.empty;
  }

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const timeline = `${formatDateOnly(items[items.length - 1]?.retrieved_at)} → ${formatDateOnly(items[0]?.retrieved_at)}`;
  return [
    `${copy.prefix}: ${items.length} ${copy.hitsLabel}, ${domains} ${copy.domainsLabel}`,
    `${copy.span}: ${timeline}`,
    copy.cue
  ].join("\n");
}

function buildSpecificitySummary(input, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      dikwText: "DIKW cue: judge whether the claim stays at the data / information / knowledge / wisdom level expected for a verifiable statement, and reward explicit facts, clear structure, and falsifiable detail.",
      fiveW1HText: "5W1H cue: let the model judge whether the claim provides enough who / what / when / where / why / how context, rather than relying on rigid keyword checks.",
      relation: "Data-to-conclusion relevance: if numbers are merely nearby, do not support the conclusion, or key variables are missing, specificity should be scored lower.",
      bayes: "Bayesian heuristic: more precise details, more concrete numbers, and more complete conditions mean lower entropy and easier verification."
    },
    es: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      dikwText: "Pista DIKW: evalúa si la afirmación se mantiene al nivel de datos / información / conocimiento / sabiduría esperado para una declaración verificable, y premia hechos explícitos, estructura clara y detalle falsable.",
      fiveW1HText: "Pista 5W1H: deja que el modelo juzgue si la afirmación aporta suficiente contexto de quién / qué / cuándo / dónde / por qué / cómo, en lugar de depender de comprobaciones rígidas de palabras clave.",
      relation: "Relevancia entre datos y conclusión: si los números solo están cerca, no respaldan la conclusión o faltan variables clave, la especificidad debe puntuarse más bajo.",
      bayes: "Heurística bayesiana: detalles más precisos, números más concretos y condiciones más completas significan menor entropía y verificación más fácil."
    },
    ja: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      dikwText: "DIKW の目安: 検証可能な主張として求められるデータ / 情報 / 知識 / 知恵の段階に沿っているかを判断し、明示的な事実、明確な構造、反証可能な詳細を高く評価します。",
      fiveW1HText: "5W1H の目安: 厳密なキーワード判定ではなく、誰 / 何 / いつ / どこ / なぜ / どうやって の文脈が十分かをモデルに判断させます。",
      relation: "データと結論の関連性: 数値が周辺にあるだけで結論を裏付けない、または重要な変数が欠けている場合、具体性のスコアは低くすべきです。",
      bayes: "ベイズ的ヒューリスティック: より正確な詳細、より具体的な数値、より完全な条件ほどエントロピーは低くなり、検証しやすくなります。"
    },
    zh: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      dikwText: "DIKW 提示：判断这条主张是否停留在适合可验证陈述的数据 / 信息 / 知识 / 智慧层级，并奖励明确事实、清晰结构和可证伪细节。",
      fiveW1HText: "5W1H 提示：让模型判断这个主张是否提供了足够的谁 / 什么 / 何时 / 何地 / 为什么 / 如何 上下文，而不是依赖僵硬的关键词命中。",
      relation: "数据与结论相关性：如果数字只是顺带出现、没有支撑结论，或者缺少关键变量，具体性应降低评分。",
      bayes: "贝叶斯启发：细节越精确、数字越具体、条件越完整，熵越低，越容易验证。"
    }
  }[language] || {
    dikw: "DIKW",
    fiveW1H: "5W1H",
    dikwText: "DIKW cue: judge whether the claim stays at the data / information / knowledge / wisdom level expected for a verifiable statement, and reward explicit facts, clear structure, and falsifiable detail.",
    fiveW1HText: "5W1H cue: let the model judge whether the claim provides enough who / what / when / where / why / how context, rather than relying on rigid keyword checks.",
    relation: "Data-to-conclusion relevance: if numbers are merely nearby, do not support the conclusion, or key variables are missing, specificity should be scored lower.",
    bayes: "Bayesian heuristic: more precise details, more concrete numbers, and more complete conditions mean lower entropy and easier verification."
  };
  const dikw = copy.dikwText;
  const fiveW1H = copy.fiveW1HText;
  const relation = copy.relation;
  const bayes = copy.bayes;
  return [dikw, fiveW1H, relation, bayes].join("\n");
}

function normalizeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return String(url || "").trim().replace(/^www\./i, "").toLowerCase();
  }
}

function buildHostnameCandidates(hostname) {
  const parts = String(hostname || "").split(".").filter(Boolean);
  const candidates = [];
  if (parts.length >= 2) {
    candidates.push(parts.slice(-2).join("."));
  }
  candidates.push(String(hostname || "").toLowerCase());
  return [...new Set(candidates)];
}

function countDistinctValues(values) {
  return new Set(values.filter(Boolean)).size;
}

function formatDateOnly(value) {
  if (!value) return "未知";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未知";
  return parsed.toISOString().slice(0, 10);
}

// ---------- Translation display helpers and localized text checks ----------
function isLikelyLocalized(text, targetLanguage) {
  const value = String(text || "");
  if (!value) return false;
  if (targetLanguage === "zh") return /[\u4E00-\u9FFF]/.test(value);
  if (targetLanguage === "ja") return /[\u3040-\u30FF\u4E00-\u9FFF]/.test(value);
  if (targetLanguage === "es") return /[áéíóúñ¿¡]/i.test(value);
  return false;
}

async function shouldTranslateText(value, sourceLanguage, targetLanguage, signal) {
  const text = String(value || "");
  if (!text) return text;
  if (isLikelyLocalized(text, targetLanguage)) return text;
  return await translateText(text, sourceLanguage, targetLanguage, signal);
}

// ---------- Evidence merging and fallback evidence ----------
function buildFallbackEvidence(input) {
  return [
    {
      title: input.title || "Current page",
      url: input.url || "",
      quote: input.selectionText || input.pageText?.slice(0, 180) || "",
      retrieved_at: input.capturedAt || new Date().toISOString(),
      source_type: "page"
    }
  ];
}

function mergeEvidenceLists(primary, secondary, input) {
  const seen = new Set();
  const merged = [];

  for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const title = String(item?.title || item?.url || "").trim();
    const url = String(item?.url || "").trim();
    const quote = String(item?.quote || "").trim();
    const key = `${title}|${url}|${quote}`;
    if (!title && !url && !quote) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      title: title || url || "Evidence",
      url,
      quote,
      retrieved_at: String(item?.retrieved_at || ""),
      source_type: String(item?.source_type || item?.type || "evidence")
    });
  }

  return merged.length > 0 ? merged : buildFallbackEvidence(input);
}

// ---------- Google News query generation, caching, throttling, and parsing ----------
async function fetchNewsBundle(input, signal, outputLanguage = "en") {
  const queries = await buildNewsQueries(input, signal);
  const anchorDate = extractAnchorDate(input);
  const query = queries[0] || "";
  console.info(`${DEBUG_PREFIX} Google News query candidates`, {
    queries,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : ""
  });
  if (!query) {
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      summary: summarizeNewsBundle("", [], "", anchorDate, outputLanguage)
    };
  }

  const cacheKey = buildNewsCacheKey(input, query, anchorDate);
  const cached = await getNewsCachedBundle(cacheKey);
  if (cached) {
    return {
      ...cached,
      summary: summarizeNewsBundle(query, cached.items || [], cached.errorMessage || "", anchorDate, outputLanguage)
    };
  }

  const cooldownUntil = await getNewsCooldownUntil();
  if (cooldownUntil > Date.now()) {
    return {
      query,
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage: `Google News temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`,
      summary: summarizeNewsBundle(query, [], `Google News temporarily rate limited. Please try again in ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds.`, anchorDate, outputLanguage)
    };
  }

  const result = await enqueueNewsRequest(() => fetchNewsItems(query, signal));
  const topItems = sortNewsItems(result.items, anchorDate).slice(0, 5);
  const bundle = {
    query,
    items: topItems,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
    errorMessage: result.errorMessage || "",
    rawPreview: String(result.rawPreview || ""),
    summary: summarizeNewsBundle(query, topItems, result.errorMessage, anchorDate, outputLanguage)
  };
  if (result.errorMessage && /429/.test(result.errorMessage)) {
    const cooldown = Date.now() + newsCooldownMs;
    newsCooldownUntil = cooldown;
    await chrome.storage.local.set({ newsCooldownUntil: cooldown });
  }
  await setNewsCachedBundle(cacheKey, bundle);
  return bundle;
}

function buildNewsCacheKey(input, query, anchorDate) {
  return [
    normalizeHostname(input?.url || ""),
    String(query || "").trim().toLowerCase(),
    String(anchorDate ? anchorDate.toISOString().slice(0, 10) : ""),
    String(input?.selectionText || "").trim().slice(0, 120),
    String(input?.title || "").trim().slice(0, 120)
  ].join("::");
}

async function getNewsCachedBundle(cacheKey) {
  const key = `newsCache:${cacheKey}`;
  const { [key]: cached } = await chrome.storage.session.get({ [key]: null });
  if (!cached || typeof cached !== "object") return null;

  const createdAt = Number(cached.createdAt || 0);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > newsCacheTtlMs) {
    await chrome.storage.session.remove(key);
    return null;
  }

  return cached.bundle || null;
}

async function setNewsCachedBundle(cacheKey, bundle) {
  const key = `newsCache:${cacheKey}`;
  await chrome.storage.session.set({
    [key]: {
      createdAt: Date.now(),
      bundle
    }
  });
}

function enqueueNewsRequest(task) {
  const next = newsRequestChain.then(async () => {
    const now = Date.now();
    const elapsed = now - newsLastRequestAt;
    if (elapsed < newsMinIntervalMs) {
      await sleep(newsMinIntervalMs - elapsed, null);
    }

    newsLastRequestAt = Date.now();
    try {
      return await task();
    } finally {
      newsLastRequestAt = Date.now();
    }
  });

  newsRequestChain = next.catch(() => {});
  return next;
}

async function fetchNewsItems(query, signal) {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("hl", "en-US");
  endpoint.searchParams.set("gl", "US");
  endpoint.searchParams.set("ceid", "US:en");

  const resp = await fetch(endpoint.toString(), { signal });
  if (!resp.ok) {
    const text = await safeReadText(resp);
    const payloadPreview = text.slice(0, 600);
    console.error(`${DEBUG_PREFIX} Google News HTTP error`, {
      status: resp.status,
      statusText: resp.statusText,
      payloadPreview,
      endpoint: endpoint.toString()
    });
    if (resp.status === 429) {
      const cooldown = Date.now() + newsCooldownMs;
      newsCooldownUntil = cooldown;
      await chrome.storage.local.set({ newsCooldownUntil: cooldown });
      return {
        items: [],
        errorMessage: `Google News access is too frequent; please try again later (${resp.status}${text ? ` - ${text}` : ""})`,
        rawPreview: payloadPreview
      };
    }
    return {
      items: [],
      errorMessage: `Google News HTTP ${resp.status}${text ? ` - ${text}` : ""}`,
      rawPreview: payloadPreview
    };
  }

  const text = await safeReadText(resp);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) {
    return {
      items: [],
      errorMessage: "Google News returned invalid RSS",
      rawPreview: text.slice(0, 600)
    };
  }
  const rawItems = Array.from(document.querySelectorAll("item"));

  return {
    items: rawItems.map(normalizeNewsItem).filter((item) => item.title || item.url),
    errorMessage: "",
    rawPreview: text.slice(0, 600)
  };
}

function normalizeNewsItem(item) {
  const getText = (selector) => item?.querySelector(selector)?.textContent?.trim() || "";
  const title = getText("title");
  const publishedAt = getText("pubDate");
  const description = getText("description");
  const url = getText("link");
  const sourceNode = item?.querySelector("source");
  const sourceUrl = sourceNode?.getAttribute("url") || "";
  const sourceFromFeed = sourceNode?.textContent?.trim() || "";
  const titleParts = title.split(" - ");
  const source = sourceFromFeed || (titleParts.length > 1 ? titleParts.pop().trim() : "Google News");
  const quote = description
    ? new DOMParser().parseFromString(description, "text/html").body?.textContent?.trim() || ""
    : "";
  return {
    title: titleParts.join(" - ").trim() || title || url || "Google News hit",
    url,
    quote: quote.slice(0, 240),
    retrieved_at: publishedAt || new Date().toISOString(),
    source_type: "google_news",
    source,
    domain: normalizeHostname(sourceUrl) || normalizeHostname(url)
  };
}

function summarizeNewsBundle(query, items, errorMessage, anchorDate, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      failed: (message) => `Google News search failed: ${message}`,
      empty: (queryText) => (queryText ? `No close Google News results were found (query: ${queryText}).` : "No close Google News results were found."),
      query: "Google News query",
      anchor: "News anchor date",
      hits: "Google News results",
      recent: "Recent events"
    },
    es: {
      failed: (message) => `La búsqueda en Google News falló: ${message}`,
      empty: (queryText) => (queryText ? `No se encontraron resultados cercanos en Google News (consulta: ${queryText}).` : "No se encontraron resultados cercanos en Google News."),
      query: "Consulta de Google News",
      anchor: "Fecha ancla de noticias",
      hits: "Resultados de Google News",
      recent: "Eventos recientes"
    },
    ja: {
      failed: (message) => `Google News 検索に失敗しました: ${message}`,
      empty: (queryText) => (queryText ? `Google News で近い結果は見つかりませんでした（検索語: ${queryText}）。` : "Google News で近い結果は見つかりませんでした。"),
      query: "Google News クエリ",
      anchor: "ニュースのアンカーデート",
      hits: "Google News の結果",
      recent: "最近のイベント"
    },
    zh: {
      failed: (message) => `Google News 搜索失败：${message}`,
      empty: (queryText) => (queryText ? `Google News 未找到接近的结果（查询：${queryText}）。` : "Google News 未找到接近的结果。"),
      query: "Google News 查询词",
      anchor: "新闻锚定日期",
      hits: "Google News 结果数",
      recent: "最近事件"
    }
  }[language];

  if (errorMessage && items.length === 0) {
    return copy.failed(errorMessage);
  }

  if (!items || items.length === 0) {
    return copy.empty(query);
  }

  const lines = items.slice(0, 3).map((item) => {
    const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
    const source = item.source ? ` · ${item.source}` : "";
    return `${date}${source} · ${item.title}`;
  });
  const queryLine = query ? `${copy.query}: ${query}\n` : "";
  const anchorLine = anchorDate
    ? `${copy.anchor}: ${anchorDate.toISOString().slice(0, 10)}\n`
    : "";
  return `${queryLine}${anchorLine}${copy.hits}: ${items.length}; ${copy.recent}:\n${lines.join("\n")}`;
}

function extractAnchorDate(input) {
  const text = [input?.selectionText, input?.title, input?.pageText].filter(Boolean).join(" ");
  const patterns = [
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    let year;
    let month;
    let day;

    if (pattern.source.includes("\\d{4})[/-]")) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else if (pattern.source.includes("年")) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function sortNewsItems(items, anchorDate) {
  const normalizedItems = Array.isArray(items) ? [...items] : [];
  if (!anchorDate) {
    return normalizedItems.sort((left, right) => getItemDate(right) - getItemDate(left));
  }

  const anchorTime = anchorDate.getTime();
  return normalizedItems.sort((left, right) => {
    const leftTime = getItemDate(left);
    const rightTime = getItemDate(right);
    const leftDistance = Math.abs(leftTime - anchorTime);
    const rightDistance = Math.abs(rightTime - anchorTime);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return rightTime - leftTime;
  });
}

function getItemDate(item) {
  const value = Date.parse(item?.retrieved_at || "");
  if (Number.isFinite(value)) return value;
  return 0;
}

async function getNewsCooldownUntil() {
  if (newsCooldownUntil > Date.now()) return newsCooldownUntil;
  const { newsCooldownUntil: stored } = await chrome.storage.local.get({ newsCooldownUntil: 0 });
  const value = Number(stored) || 0;
  newsCooldownUntil = value;
  return value;
}

async function buildNewsQueries(input, signal) {
  const promptQuery = await buildPromptDrivenNewsQuery(input, signal);
  return promptQuery ? [promptQuery] : [];
}

async function buildPromptDrivenNewsQuery(input, signal) {
  if (signal?.aborted) return "";

  const text = [
    String(input?.analysisText || "").trim(),
    String(input?.selectionText || "").trim(),
    String(input?.title || "").trim(),
    String(input?.pageText || "").trim()
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!text) return "";

  const api = globalThis.LanguageModel;
  if (!api) return "";

  try {
    const availability = await api.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    });
    if (availability === "unavailable") return "";

    const session = await api.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      signal
    });

    const queryPrompt = [
      "You are generating a Google News RSS search query.",
      "Return only one short English query string.",
      "Do not explain, do not use markdown, do not use quotes, and do not include bullets.",
      "Keep only the most important named entities, organizations, locations, dates, numbers, and event or action words.",
      "Avoid filler words and avoid tokens shorter than 3 characters.",
      "Prefer 4 to 8 words total.",
      "Text:",
      text
    ].join("\n");

    const raw = sanitizeModelText(await session.prompt(queryPrompt, { signal }));
    return cleanNewsQuery(raw);
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError" || String(err?.message || err).includes("aborted")) {
      return "";
    }
    console.info(`${DEBUG_PREFIX} Google News prompt query unavailable`, {
      message: String(err?.message || err),
      stack: err?.stack || ""
    });
    return "";
  }
}

function cleanNewsQuery(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/["'`]/g, " ")
    .replace(/[^\p{L}\p{N}%&\-. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const seen = new Set();
  const tokens = [];
  for (const rawToken of normalized.split(" ")) {
    const token = rawToken.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9%]+$/g, "").trim();
    if (!token) continue;
    const shortToken = token.length < 3;
    const numericToken = /^\d+(?:[.,]\d+)?%?$/.test(token);
    const upperTicker = /^[A-Z]{3,5}$/.test(token);
    if (shortToken && !numericToken && !upperTicker) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
    if (tokens.length >= 8) break;
  }
  return tokens.join(" ").trim();
}
// ---------- Generic normalization helpers for scores, verdicts, and parsed payloads ----------
function normalizeRuleScores(ruleScores) {
  const scores = ruleScores && typeof ruleScores === "object" ? ruleScores : {};
  return {
    reproducibility: normalizeConfidence(scores.reproducibility ?? scores.repro ?? scores.repeatability),
    cross_validation: normalizeConfidence(scores.cross_validation ?? scores.cross ?? scores.validation),
    detail_richness: normalizeConfidence(scores.detail_richness ?? scores.detail ?? scores.dikw)
  };
}

function normalizeRuleNotes(ruleNotes) {
  if (!ruleNotes || typeof ruleNotes !== "object") return null;
  return {
    reproducibility: String(ruleNotes.reproducibility || ruleNotes.repro || "").trim(),
    cross_validation: String(ruleNotes.cross_validation || ruleNotes.cross || "").trim(),
    detail_richness: String(ruleNotes.detail_richness || ruleNotes.detail || "").trim()
  };
}

function averageRuleScores(ruleScores) {
  const values = [
    ruleScores?.reproducibility,
    ruleScores?.cross_validation,
    ruleScores?.detail_richness
  ].filter((value) => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function verdictFromScore(score) {
  if (score >= 0.7) return "supported";
  if (score <= 0.3) return "contradicted";
  return "unclear";
}

function formatScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "—";
  return `${Math.round(score * 100)}%`;
}

function normalizeEvidence(evidence, input) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return buildFallbackEvidence(input);
  }

  return evidence.map((item) => ({
    title: String(item?.title || item?.source || input.title || "Evidence"),
    url: String(item?.url || input.url || ""),
    quote: String(item?.quote || item?.excerpt || item?.rationale || "").trim(),
    retrieved_at: String(item?.retrieved_at || input.capturedAt || new Date().toISOString()),
    source_type: String(item?.source_type || item?.type || "evidence")
  }));
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeVerdict(verdict) {
  const value = String(verdict || "").toLowerCase();
  if (value === "supported" || value === "contradicted" || value === "unclear") {
    return value;
  }
  return "unclear";
}

function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return clamp(num, 0, 1);
}

function parseAssessmentJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidate = candidate.slice(first, last + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function formatError(err) {
  const message = String(err?.message || err || "Unknown error");
  return `Local AI unavailable: ${message}`;
}

function sanitizeModelText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim();
}

async function safeReadText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }

    if (signal?.aborted) {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "VERIFY_STARTED") {
    const payload = message.payload || {};
    currentVerification = payload;
    updateModeButtons();
    if (payload.state === "loading" && payload.input) {
      void startVerification(payload, { allowDownload: true });
    }
  }

  if (message.type === "VERIFY_RESULT") {
    const payload = message.payload || {};
    currentVerification = {
      ...currentVerification,
      state: "done",
      result: payload
    };
    renderVerification(payload);
  }
});

hydrateInitialState().catch(() => {});
