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
const gdeltSummaryEl = document.getElementById("gdeltSummary");
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
let gdeltRequestChain = Promise.resolve();
let gdeltLastRequestAt = 0;
let mbfcDatasetPromise = null;
let gdeltCooldownUntil = 0;
let lastDebugTrace = "";
const DEBUG_PREFIX = "[InfoVerify]";
const minLoadingMs = 700;
const gdeltMinIntervalMs = 5200;
const gdeltCacheTtlMs = 15 * 60 * 1000;
const gdeltCooldownMs = 2 * 60 * 1000;
const minGdeltTermLength = 3;
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

localModeButtonEl.addEventListener("click", () => {
  void requestRun();
});

debugCopyButtonEl.addEventListener("click", () => {
  if (!lastDebugTrace) return;
  void navigator.clipboard?.writeText?.(lastDebugTrace).then(() => {
    debugStatusEl.textContent = "已复制到剪贴板";
    window.setTimeout(() => {
      if (debugStatusEl.textContent === "已复制到剪贴板") {
        debugStatusEl.textContent = "—";
      }
    }, 1500);
  }).catch(() => {
    debugStatusEl.textContent = "复制失败，请手动全选后复制";
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
      gdeltSummary: truncateForDebug(fields.gdeltSummary, 1200),
      gdeltRawPreview: truncateForDebug(fields.gdeltRawPreview, 1200),
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
  debugStatusEl.textContent = "可复制后贴给我排查";
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
    gdelt_summary: await shouldTranslateText(result.gdelt_summary, sourceLanguage, targetLanguage, signal),
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

function updateModeButtons() {
  localModeButtonEl.classList.toggle("active", true);
  cloudModeButtonEl.classList.toggle("active", false);
  modePillEl.textContent = "本地 AI";
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
      setStatus("正在调用本地 AI");
    }
    thinkingTextEl.textContent = "正在分析文本、搜索 GDELT 新闻并生成本地结论";
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
    thinkingTextEl.textContent = "已完成";
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
  gdeltSummaryEl.textContent = "—";
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
  setStatus("已完成");
  setVerdict(payload.verdict, payload.confidence);
  summaryEl.textContent = payload.summary || "—";
  renderRuleScores(payload.rule_scores || null, payload.rule_notes || null, {
    specificity: payload.specificity_summary || "",
    cross_validation: payload.cross_validation_summary || "",
    reproducibility: payload.reproducibility_summary || ""
  });
  renderEvidence(payload.evidence);
  gdeltSummaryEl.textContent = payload.gdelt_summary || "—";
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
    typeof confidence === "number" ? `置信度 ${(confidence * 100).toFixed(0)}%` : "—";
}

function setLLMAssessment(assess) {
  llmVerdictPillEl.className = "pill";
  llmVerdictPillEl.textContent = assess?.verdict || "—";
  const verdict = assess?.verdict;
  if (verdict === "high") llmVerdictPillEl.classList.add("good");
  else if (verdict === "low") llmVerdictPillEl.classList.add("bad");
  else if (verdict === "medium" || verdict === "unclear") llmVerdictPillEl.classList.add("warn");

  llmConfidenceEl.textContent =
    typeof assess?.confidence === "number" ? `置信度 ${(assess.confidence * 100).toFixed(0)}%` : "—";

  if (assess?.error) llmRationaleEl.textContent = `不可用：${assess.error}`;
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

async function runLocalAnalysis(input, signal, { allowDownload = false } = {}) {
  const api = globalThis.LanguageModel;
  if (!api) {
    throw new Error("Chrome 内置 AI 不可用，请稍后重试");
  }

  const outputLanguage = await getPreferredOutputLanguage();
  const modelOutputLanguage = resolveModelOutputLanguage(outputLanguage);

  const availability = await api.availability({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: [modelOutputLanguage] }]
  });

  if (availability !== "available" && !allowDownload) {
    throw new Error("Chrome 本地 AI 需要先就绪，请点击“本地 AI”按钮后再试");
  }

  gdeltSummaryEl.textContent = "正在搜索 GDELT 相关新闻…";
  const gdeltBundle = await fetchGdeltBundle(input, signal, outputLanguage);
  gdeltSummaryEl.textContent = gdeltBundle.summary || "—";
  const mbfcEntry = await lookupMbfcEntry(input.url || "");
  const session = await api.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: [modelOutputLanguage] }],
    signal
  });

  const prompt = buildLocalPrompt(input, gdeltBundle, mbfcEntry, modelOutputLanguage, outputLanguage);
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
  console.error(`${DEBUG_PREFIX} local AI raw output`, {
    outputLanguage,
    modelOutputLanguage,
    promptPreview: truncateForDebug(prompt, 2500),
    rawPreview: truncateForDebug(raw, 3500)
  });
  const parsed = parseAssessmentJson(raw);
  if (!parsed) {
    const fallback = buildDeterministicLocalAssessment(input, gdeltBundle, mbfcEntry, raw, outputLanguage);
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
      mbfc: mbfcEntry
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
    evidence: mergeEvidenceLists(normalizeEvidence(parsed.evidence, input), gdeltBundle.items, input),
    conflicts: normalizeList(parsed.conflicts),
    missing: normalizeList(parsed.missing),
    gdelt_summary: gdeltBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(gdeltBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };

  const localizedResult = outputLanguage === "zh"
    ? await localizeAssessmentResult(result, outputLanguage, signal)
    : result;
  console.error(`${DEBUG_PREFIX} local AI success`, {
    outputLanguage,
    modelOutputLanguage,
    verdict: localizedResult.verdict,
    confidence: localizedResult.confidence,
    stack: ""
  });
  return localizedResult;
}

function buildDeterministicLocalAssessment(input, gdeltBundle, mbfcEntry, raw, outputLanguage) {
  const rule_scores = buildDeterministicRuleScores(input, gdeltBundle, mbfcEntry);
  const confidence = normalizeConfidence(averageRuleScores(rule_scores));
  const rationale = sanitizeModelText(raw) || fallbackLanguageText(outputLanguage, "noOutput");
  return {
    verdict: normalizeVerdict(verdictFromScore(confidence)),
    confidence,
    summary: rationale,
    rationale,
    rule_scores,
    rule_notes: {
      reproducibility: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
      cross_validation: buildCrossValidationSummary(gdeltBundle, outputLanguage),
      detail_richness: buildSpecificitySummary(input, outputLanguage)
    },
    evidence: mergeEvidenceLists(buildFallbackEvidence(input), gdeltBundle.items, input),
    conflicts: [],
    missing: raw ? [fallbackLanguageText(outputLanguage, "jsonFallback")] : [fallbackLanguageText(outputLanguage, "noOutput")],
    gdelt_summary: gdeltBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage),
    cross_validation_summary: buildCrossValidationSummary(gdeltBundle, outputLanguage),
    specificity_summary: buildSpecificitySummary(input, outputLanguage)
  };
}

function buildDeterministicRuleScores(input, gdeltBundle, mbfcEntry) {
  return {
    reproducibility: scoreReproducibility(gdeltBundle, mbfcEntry),
    cross_validation: scoreCrossValidation(gdeltBundle),
    detail_richness: scoreSpecificity(input)
  };
}

function scoreSpecificity(input) {
  const text = getAnalysisText(input) || `${input?.selectionText || ""} ${input?.pageText || ""}`;
  const normalized = String(text || "");
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const numbers = (normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const dates = (normalized.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{4}年\d{1,2}月\d{1,2}日)|(?:\d{1,2}\/\d{1,2}\/\d{4})/g) || []).length;
  const entities = extractGdeltKeywords(normalized).length;
  const hasConcreteQuestion = /(?:谁|what|who|when|where|why|how|什么|何时|何地|为什么|如何)/i.test(normalized);
  const score = 0.18 + Math.min(0.35, words / 180) + Math.min(0.18, numbers * 0.05) + Math.min(0.12, dates * 0.06) + Math.min(0.1, entities * 0.015) + (hasConcreteQuestion ? 0.07 : 0);
  return clamp(score, 0, 1);
}

function scoreCrossValidation(gdeltBundle) {
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  if (items.length === 0) return 0.12;

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const countries = countDistinctValues(items.map((item) => item.country).filter(Boolean));
  const dates = countDistinctValues(items.map((item) => formatDateOnly(item.retrieved_at)).filter((value) => value && value !== "未知"));
  const toneCount = countDistinctValues(items.map((item) => item.tone).filter(Boolean));
  const score = 0.22 +
    Math.min(0.22, items.length * 0.04) +
    Math.min(0.16, Math.max(0, domains - 1) * 0.08) +
    Math.min(0.12, Math.max(0, countries - 1) * 0.06) +
    Math.min(0.12, Math.max(0, dates - 1) * 0.05) +
    Math.min(0.08, Math.max(0, toneCount - 1) * 0.04);
  return clamp(score, 0, 1);
}

function scoreReproducibility(gdeltBundle, mbfcEntry) {
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
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
    gdelt_summary: String(payload?.gdelt_summary || ""),
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
        title: input.title || "当前页面",
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
    gdelt_summary: ""
  };
}

function buildLocalPrompt(input, gdeltBundle, mbfcEntry, modelOutputLanguage = "en", displayLanguage = "en") {
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
    "You are a financial information verification assistant. Judge only from the text below, the GDELT evidence, and your training knowledge. Do not browse the web or invent outside facts.",
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

const LOCAL_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "confidence",
    "overall_score",
    "summary",
    "rationale",
    "rule_scores",
    "rule_notes",
    "evidence",
    "conflicts",
    "missing"
  ],
  properties: {
    verdict: {
      type: "string",
      enum: ["supported", "contradicted", "unclear"]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    overall_score: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    summary: {
      type: "string"
    },
    rationale: {
      type: "string"
    },
    rule_scores: {
      type: "object",
      additionalProperties: false,
      required: ["reproducibility", "cross_validation", "detail_richness"],
      properties: {
        reproducibility: { type: "number", minimum: 0, maximum: 1 },
        cross_validation: { type: "number", minimum: 0, maximum: 1 },
        detail_richness: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    rule_notes: {
      type: "object",
      additionalProperties: false,
      required: ["reproducibility", "cross_validation", "detail_richness"],
      properties: {
        reproducibility: { type: "string" },
        cross_validation: { type: "string" },
        detail_richness: { type: "string" }
      }
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["title", "url", "quote"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          quote: { type: "string" }
        }
      }
    },
    conflicts: {
      type: "array",
      items: { type: "string" }
    },
    missing: {
      type: "array",
      items: { type: "string" }
    }
  }
};

function getAnalysisText(input) {
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

async function repairAssessmentJson(session, raw, signal) {
  const text = sanitizeModelText(raw);
  if (!text) return "";

  const repairPrompt = [
    "请把下面的内容修复成严格合法的 JSON 对象，只输出 JSON 本身，不要解释，不要 markdown，不要代码块。",
    "如果原文里已经有 JSON，请修正它并补全缺失字段。",
    "如果原文不是 JSON，请根据原文生成 best-effort 的 JSON，并保留原文的结论与证据。",
    "必须包含这些键：verdict、confidence、overall_score、summary、rationale、rule_scores、rule_notes、evidence、conflicts、missing。",
    "内容如下：",
    text
  ].join("\n");

  try {
    return await session.prompt(repairPrompt, { signal });
  } catch {
    return "";
  }
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

function buildReproducibilitySummary(gdeltBundle, mbfcEntry, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      mbfc: "MBFC",
      noMatch: "no static match or the domain has not been packaged yet.",
      timeline: "GDELT timeline",
      first: "first",
      recent: "recent",
      distinct: "distinct domains",
      noData: "no usable news events found.",
      cue: "Assessment cue: reproducibility is stronger when the source is stable over time, repeats across events, and has better domain reputation."
    },
    es: {
      mbfc: "MBFC",
      noMatch: "no hay coincidencia estática o el dominio aún no se ha empaquetado.",
      timeline: "Cronología de GDELT",
      first: "primera",
      recent: "reciente",
      distinct: "dominios distintos",
      noData: "no se encontraron eventos de noticias utilizables.",
      cue: "Pista de evaluación: la reproducibilidad es mayor cuando la fuente es estable en el tiempo, se repite entre eventos y tiene mejor reputación de dominio."
    },
    ja: {
      mbfc: "MBFC",
      noMatch: "静的な一致がないか、まだそのドメインがパッケージ化されていません。",
      timeline: "GDELT タイムライン",
      first: "最初",
      recent: "最近",
      distinct: "異なるドメイン",
      noData: "利用できるニュースイベントは見つかりませんでした。",
      cue: "評価の目安: 情報源が時間的に安定し、複数のイベントで繰り返され、ドメイン評価が高いほど再現性は高くなります。"
    },
    zh: {
      mbfc: "MBFC",
      noMatch: "没有静态匹配，或者该域名尚未打包。",
      timeline: "GDELT 时间线",
      first: "首次",
      recent: "最近",
      distinct: "个独立域名",
      noData: "未找到可用新闻事件。",
      cue: "评估提示：如果信源在时间上稳定、反复出现且域名信誉较好，可重复性更高。"
    }
  }[language] || {
    mbfc: "MBFC",
    noMatch: "no static match or the domain has not been packaged yet.",
    timeline: "GDELT timeline",
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

  if (gdeltBundle?.items?.length) {
    const firstDate = gdeltBundle.items[gdeltBundle.items.length - 1]?.retrieved_at || "";
    const lastDate = gdeltBundle.items[0]?.retrieved_at || "";
    const domains = countDistinctValues(gdeltBundle.items.map((item) => item.domain).filter(Boolean));
    lines.push(`${copy.timeline}: ${copy.first} ${formatDateOnly(firstDate)} · ${copy.recent} ${formatDateOnly(lastDate)} · ${copy.distinct} ${domains}`);
  } else {
    lines.push(`${copy.timeline}: ${copy.noData}`);
  }

  lines.push(copy.cue);
  return lines.join("\n");
}

function buildCrossValidationSummary(gdeltBundle, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      empty: "GDELT cross-validation: no usable news events, so independent corroboration is weak.",
      prefix: "GDELT cross-validation",
      hitsLabel: "hits",
      domainsLabel: "distinct domains",
      countriesLabel: "source countries",
      tone: "Tone distribution",
      span: "Time span",
      cue: "Assessment cue: cross-validation is stronger when multiple domains, multiple countries, and consistent tone all align."
    },
    es: {
      empty: "Validación cruzada de GDELT: no hay eventos de noticias utilizables, por lo que la corroboración independiente es débil.",
      prefix: "Validación cruzada de GDELT",
      hitsLabel: "coincidencias",
      domainsLabel: "dominios distintos",
      countriesLabel: "países de origen",
      tone: "Distribución de tono",
      span: "Intervalo de tiempo",
      cue: "Pista de evaluación: la validación cruzada es más fuerte cuando coinciden múltiples dominios, múltiples países y un tono consistente."
    },
    ja: {
      empty: "GDELT のクロス検証: 利用できるニュースイベントがなく、独立した裏付けは弱いです。",
      prefix: "GDELT のクロス検証",
      hitsLabel: "件のヒット",
      domainsLabel: "異なるドメイン",
      countriesLabel: "発信国",
      tone: "トーン分布",
      span: "期間",
      cue: "評価の目安: 複数のドメイン、複数の国、そして一貫したトーンがそろうほどクロス検証は強くなります。"
    },
    zh: {
      empty: "GDELT 交叉验证：没有可用新闻事件，因此独立印证较弱。",
      prefix: "GDELT 交叉验证",
      hitsLabel: "条命中",
      domainsLabel: "个独立域名",
      countriesLabel: "个来源国家",
      tone: "口径分布",
      span: "时间范围",
      cue: "评估提示：当多个域名、多个国家和一致的口径同时出现时，交叉验证会更强。"
    }
  }[language] || {
    empty: "GDELT cross-validation: no usable news events, so independent corroboration is weak.",
    prefix: "GDELT cross-validation",
    hitsLabel: "hits",
    domainsLabel: "distinct domains",
    countriesLabel: "source countries",
    tone: "Tone distribution",
    span: "Time span",
    cue: "Assessment cue: cross-validation is stronger when multiple domains, multiple countries, and consistent tone all align."
  };
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  if (items.length === 0) {
    return copy.empty;
  }

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const countries = countDistinctValues(items.map((item) => item.country).filter(Boolean));
  const tones = summarizeCounts(items.map((item) => item.tone).filter(Boolean));
  const timeline = `${formatDateOnly(items[items.length - 1]?.retrieved_at)} → ${formatDateOnly(items[0]?.retrieved_at)}`;
  return [
    `${copy.prefix}: ${items.length} ${copy.hitsLabel}, ${domains} ${copy.domainsLabel}, ${countries} ${copy.countriesLabel}`,
    tones ? `${copy.tone}: ${tones}` : `${copy.tone}: unavailable`,
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
      relation: "Data-to-conclusion relevance: if numbers are merely nearby, do not support the conclusion, or key variables are missing, specificity should be scored lower.",
      bayes: "Bayesian heuristic: more precise details, more concrete numbers, and more complete conditions mean lower entropy and easier verification.",
      currentText: "Current text length"
    },
    es: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      relation: "Relevancia entre datos y conclusión: si los números solo están cerca, no respaldan la conclusión o faltan variables clave, la especificidad debe puntuarse más bajo.",
      bayes: "Heurística bayesiana: detalles más precisos, números más concretos y condiciones más completas significan menor entropía y verificación más fácil.",
      currentText: "Longitud actual del texto"
    },
    ja: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      relation: "データと結論の関連性: 数値が周辺にあるだけで結論を裏付けない、または重要な変数が欠けている場合、具体性のスコアは低くすべきです。",
      bayes: "ベイズ的ヒューリスティック: より正確な詳細、より具体的な数値、より完全な条件ほどエントロピーは低くなり、検証しやすくなります。",
      currentText: "現在のテキスト長"
    },
    zh: {
      dikw: "DIKW",
      fiveW1H: "5W1H",
      relation: "数据与结论相关性：如果数字只是顺带出现、没有支撑结论，或者缺少关键变量，具体性应降低评分。",
      bayes: "贝叶斯启发：细节越精确、数字越具体、条件越完整，熵越低，越容易验证。",
      currentText: "当前文本长度"
    }
  }[language] || {
    dikw: "DIKW",
    fiveW1H: "5W1H",
    relation: "Data-to-conclusion relevance: if numbers are merely nearby, do not support the conclusion, or key variables are missing, specificity should be scored lower.",
    bayes: "Bayesian heuristic: more precise details, more concrete numbers, and more complete conditions mean lower entropy and easier verification.",
    currentText: "Current text length"
  };
  const text = getAnalysisText(input) || `${input?.selectionText || ""} ${input?.pageText || ""}`;
  const normalized = String(text || "");
  const words = normalized.split(/\s+/).filter(Boolean);
  const numbers = normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  const dates = normalized.match(/(?:\d{4}[/-]\d{1,2}[/-]\d{1,2})|(?:\d{4}年\d{1,2}月\d{1,2}日)|(?:\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
  const who = /(?:谁|who|which company|which person)/i.test(normalized);
  const what = /(?:什么|what|earnings|revenue|profit|guidance|lawsuit|merger|policy)/i.test(normalized);
  const when = /(?:何时|when|time|date|today|yesterday|tomorrow)/i.test(normalized);
  const where = /(?:何地|where|china|us|u\.s\.|america|new york|beijing)/i.test(normalized);
  const why = /(?:为什么|why|because|reason)/i.test(normalized);
  const how = /(?:如何|how|method|way|via)/i.test(normalized);

  const dikw = `${copy.dikw}: focus on verifiable detail, explicit data, and explicit causality. ${copy.currentText}: ${words.length} words, ${numbers.length} numbers, ${dates.length} dates.`;
  const fiveW1H = `${copy.fiveW1H}: who=${yesNo(who)}, what=${yesNo(what)}, when=${yesNo(when)}, where=${yesNo(where)}, why=${yesNo(why)}, how=${yesNo(how)}.`;
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

function summarizeCounts(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
}

function formatDateOnly(value) {
  if (!value) return "未知";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未知";
  return parsed.toISOString().slice(0, 10);
}

function yesNo(value) {
  return value ? "有" : "无";
}

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

function buildFallbackEvidence(input) {
  return [
    {
      title: input.title || "当前页面",
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

async function fetchGdeltBundle(input, signal, outputLanguage = "en") {
  const queries = buildGdeltQueries(input);
  const anchorDate = extractAnchorDate(input);
  const query = queries[0] || "";
  console.debug(`${DEBUG_PREFIX} GDELT query candidates`, {
    queries,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : ""
  });
  if (!query) {
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      summary: summarizeGdeltBundle("", [], "", anchorDate, outputLanguage)
    };
  }

  const cacheKey = buildGdeltCacheKey(input, query, anchorDate);
  const cached = await getGdeltCachedBundle(cacheKey);
  if (cached) {
    return {
      ...cached,
      summary: summarizeGdeltBundle(query, cached.items || [], cached.errorMessage || "", anchorDate, outputLanguage)
    };
  }

  const cooldownUntil = await getGdeltCooldownUntil();
  if (cooldownUntil > Date.now()) {
    return {
      query,
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      errorMessage: `GDELT 暂时限流，已进入冷却期，${Math.ceil((cooldownUntil - Date.now()) / 1000)} 秒后再试`,
      summary: summarizeGdeltBundle(query, [], `GDELT 暂时限流，已进入冷却期，${Math.ceil((cooldownUntil - Date.now()) / 1000)} 秒后再试`, anchorDate, outputLanguage)
    };
  }

  const result = await enqueueGdeltRequest(() => fetchGdeltItems(query, signal));
  const topItems = sortGdeltItems(result.items, anchorDate).slice(0, 5);
  const bundle = {
    query,
    items: topItems,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
    errorMessage: result.errorMessage || "",
    rawPreview: String(result.rawPreview || ""),
    summary: summarizeGdeltBundle(query, topItems, result.errorMessage, anchorDate, outputLanguage)
  };
  if (result.errorMessage && /429/.test(result.errorMessage)) {
    const cooldown = Date.now() + gdeltCooldownMs;
    gdeltCooldownUntil = cooldown;
    await chrome.storage.local.set({ gdeltCooldownUntil: cooldown });
  }
  await setGdeltCachedBundle(cacheKey, bundle);
  return bundle;
}

function buildGdeltCacheKey(input, query, anchorDate) {
  return [
    normalizeHostname(input?.url || ""),
    String(query || "").trim().toLowerCase(),
    String(anchorDate ? anchorDate.toISOString().slice(0, 10) : ""),
    String(input?.selectionText || "").trim().slice(0, 120),
    String(input?.title || "").trim().slice(0, 120)
  ].join("::");
}

async function getGdeltCachedBundle(cacheKey) {
  const key = `gdeltCache:${cacheKey}`;
  const { [key]: cached } = await chrome.storage.session.get({ [key]: null });
  if (!cached || typeof cached !== "object") return null;

  const createdAt = Number(cached.createdAt || 0);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > gdeltCacheTtlMs) {
    await chrome.storage.session.remove(key);
    return null;
  }

  return cached.bundle || null;
}

async function setGdeltCachedBundle(cacheKey, bundle) {
  const key = `gdeltCache:${cacheKey}`;
  await chrome.storage.session.set({
    [key]: {
      createdAt: Date.now(),
      bundle
    }
  });
}

function enqueueGdeltRequest(task) {
  const next = gdeltRequestChain.then(async () => {
    const now = Date.now();
    const elapsed = now - gdeltLastRequestAt;
    if (elapsed < gdeltMinIntervalMs) {
      await sleep(gdeltMinIntervalMs - elapsed, null);
    }

    gdeltLastRequestAt = Date.now();
    try {
      return await task();
    } finally {
      gdeltLastRequestAt = Date.now();
    }
  });

  gdeltRequestChain = next.catch(() => {});
  return next;
}

async function fetchGdeltItems(query, signal) {
  const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  endpoint.searchParams.set("mode", "artlist");
  endpoint.searchParams.set("format", "jsonfeed");
  endpoint.searchParams.set("sort", "datedesc");
  endpoint.searchParams.set("maxrecords", "8");
  endpoint.searchParams.set("timespan", "30d");
  endpoint.searchParams.set("query", query);

  const resp = await fetch(endpoint.toString(), { signal });
  if (!resp.ok) {
    const text = await safeReadText(resp);
    const payloadPreview = text.slice(0, 600);
    console.error(`${DEBUG_PREFIX} GDELT HTTP error`, {
      status: resp.status,
      statusText: resp.statusText,
      payloadPreview,
      endpoint: endpoint.toString()
    });
    if (resp.status === 429) {
      const cooldown = Date.now() + gdeltCooldownMs;
      gdeltCooldownUntil = cooldown;
      await chrome.storage.local.set({ gdeltCooldownUntil: cooldown });
      return {
        items: [],
        errorMessage: `GDELT 访问过于频繁，请稍后再试（${resp.status}${text ? ` - ${text}` : ""}）`,
        rawPreview: payloadPreview
      };
    }
    return {
      items: [],
      errorMessage: `GDELT HTTP ${resp.status}${text ? ` - ${text}` : ""}`,
      rawPreview: payloadPreview
    };
  }

  const text = await safeReadText(resp);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    const parseError = new Error(`GDELT returned non-JSON response: ${text ? text.slice(0, 220) : "empty response"}`);
    console.error(`${DEBUG_PREFIX} GDELT non-JSON response`, parseError, {
      endpoint: endpoint.toString(),
      payloadPreview: text.slice(0, 600)
    });
    return {
      items: [],
      errorMessage: `GDELT returned non-JSON response${text ? `: ${text.slice(0, 220)}` : ""}`,
      rawPreview: text.slice(0, 600)
    };
  }
  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.feed?.items)
      ? data.feed.items
      : [];

  return {
    items: rawItems.map(normalizeGdeltItem).filter((item) => item.title || item.url),
    errorMessage: "",
    rawPreview: text.slice(0, 600)
  };
}

function normalizeGdeltItem(item) {
  const publishedAt = String(item?.date_published || item?.date_modified || item?.published || "").trim();
  const source = String(item?.source || item?.author?.name || item?.author || item?.publisher || "").trim();
  const quote = String(item?.content_text || item?.summary || item?.description || "").trim();
  const url = String(item?.url || item?.external_url || item?.id || "").trim();
  return {
    title: String(item?.title || item?.id || "GDELT 命中").trim(),
    url,
    quote: quote ? quote.slice(0, 240) : "",
    retrieved_at: publishedAt || new Date().toISOString(),
    source_type: "gdelt",
    source,
    domain: normalizeHostname(url),
    country: String(item?.country || item?.source_country || item?.sourceCountry || item?.location || "").trim(),
    tone: String(item?.tone || item?.sentiment || item?.mood || "").trim()
  };
}

function summarizeGdeltBundle(query, items, errorMessage, anchorDate, outputLanguage = "en") {
  const language = resolveOutputLanguage(outputLanguage);
  const copy = {
    en: {
      failed: (message) => `GDELT search failed: ${message}`,
      empty: (queryText) => (queryText ? `No close GDELT news events were found in the last 30 days (query: ${queryText}).` : "No close GDELT news events were found in the last 30 days."),
      query: "GDELT query",
      anchor: "GDELT anchor date",
      hits: "GDELT hits in the last 30 days",
      recent: "Recent events"
    },
    es: {
      failed: (message) => `La búsqueda en GDELT falló: ${message}`,
      empty: (queryText) => (queryText ? `No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días (consulta: ${queryText}).` : "No se encontraron eventos de noticias cercanos en GDELT en los últimos 30 días."),
      query: "Consulta de GDELT",
      anchor: "Fecha ancla de GDELT",
      hits: "Resultados de GDELT en los últimos 30 días",
      recent: "Eventos recientes"
    },
    ja: {
      failed: (message) => `GDELT 検索に失敗しました: ${message}`,
      empty: (queryText) => (queryText ? `直近30日間で近いGDELTニュースイベントは見つかりませんでした（検索語: ${queryText}）。` : "直近30日間で近いGDELTニュースイベントは見つかりませんでした。"),
      query: "GDELT クエリ",
      anchor: "GDELT アンカーデート",
      hits: "直近30日間のGDELTヒット数",
      recent: "最近のイベント"
    },
    zh: {
      failed: (message) => `GDELT 搜索失败：${message}`,
      empty: (queryText) => (queryText ? `过去 30 天未找到接近的 GDELT 新闻事件（查询：${queryText}）。` : "过去 30 天未找到接近的 GDELT 新闻事件。"),
      query: "GDELT 查询词",
      anchor: "GDELT 锚定日期",
      hits: "过去 30 天 GDELT 命中数",
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

function sortGdeltItems(items, anchorDate) {
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

async function getGdeltCooldownUntil() {
  if (gdeltCooldownUntil > Date.now()) return gdeltCooldownUntil;
  const { gdeltCooldownUntil: stored } = await chrome.storage.local.get({ gdeltCooldownUntil: 0 });
  const value = Number(stored) || 0;
  gdeltCooldownUntil = value;
  return value;
}

function buildGdeltQueries(input) {
  const candidates = [];
  const selection = String(input?.selectionText || "").trim();
  const title = String(input?.title || "").trim();
  const pageText = String(input?.pageText || "").trim();

  if (selection) {
    const selectionQuery = normalizeGdeltQuery(selection);
    if (selectionQuery) {
      candidates.push(selectionQuery);
    }
  }

  const combined = [selection, title, pageText.slice(0, 1200)].filter(Boolean).join(" ");
  const keywords = extractGdeltKeywords(combined).filter(isValidGdeltQueryToken);
  if (keywords.length > 0) {
    candidates.push(keywords.slice(0, 6).join(" "));
  }

  const titleKeywords = extractGdeltKeywords(title);
  if (titleKeywords.length > 0) {
    const titleQuery = titleKeywords.filter(isValidGdeltQueryToken).slice(0, 5).join(" ");
    if (titleQuery) candidates.push(titleQuery);
  }

  const fallback = extractGdeltKeywords(pageText);
  if (fallback.length > 0) {
    const fallbackQuery = fallback.filter(isValidGdeltQueryToken).slice(0, 4).join(" ");
    if (fallbackQuery) candidates.push(fallbackQuery);
  }

  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))].slice(0, 4);
}

function normalizeGdeltQuery(text) {
  const keywords = extractGdeltKeywords(text).filter(isValidGdeltQueryToken);
  if (keywords.length === 0) return "";
  return keywords.slice(0, 6).join(" ");
}

function extractGdeltKeywords(text) {
  const normalized = String(text || "")
    .replace(/[\u2018\u2019\u201c\u201d]/g, '"')
    .replace(/[\r\n]+/g, " ")
    .trim();

  if (!normalized) return [];

  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "your",
    "have",
    "will",
    "into",
    "are",
    "was",
    "were",
    "been",
    "they",
    "them",
    "their",
    "about",
    "there",
    "which",
    "when",
    "what",
    "where",
    "who",
    "whom",
    "why",
    "how",
    "stock",
    "stocks",
    "news",
    "article",
    "page",
    "result",
    "analysis"
  ]);

  const phraseMatches = normalized.match(/"([^"]{3,80})"/g) || [];
  const phrases = phraseMatches
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter((item) => item && item.split(/\s+/).some((part) => part.length >= minGdeltTermLength));

  const tokens = normalized
    .split(/[^A-Za-z0-9.$%+/:-]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= minGdeltTermLength)
    .filter((item) => !stopWords.has(item.toLowerCase()));

  const tickerMatches = normalized.match(/\b[A-Z]{2,5}(?:\.[A-Z]{1,2})?\b/g) || [];
  const numericMatches = normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || [];

  const values = [...phrases, ...tickerMatches, ...numericMatches, ...tokens];
  const deduped = [];
  const seen = new Set();
  for (const value of values) {
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }

  return deduped;
}

function isValidGdeltQueryToken(value) {
  const token = String(value || "").trim();
  if (!token) return false;
  if (/^\d+(?:\.\d+)?%?$/.test(token)) return true;
  if (/^[A-Z0-9.:-]+$/.test(token) && token.length >= minGdeltTermLength) return true;
  return token.length >= minGdeltTermLength;
}

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

function pct(v) {
  if (typeof v !== "number") return "—";
  return `${Math.round(v * 100)}%`;
}

function formatError(err) {
  const message = String(err?.message || err || "Unknown error");
  return `本地 AI 不可用：${message}`;
}

function sanitizeModelText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim();
}

async function safeReadText(resp) {
  try {
    return (await resp.text())?.slice(0, 500);
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
