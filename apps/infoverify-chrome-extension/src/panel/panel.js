const statusEl = document.getElementById("status");
const thinkingBannerEl = document.getElementById("thinkingBanner");
const thinkingTextEl = document.getElementById("thinkingText");
const verdictPillEl = document.getElementById("verdictPill");
const confidenceEl = document.getElementById("confidence");
const summaryEl = document.getElementById("summary");
const reproScoreEl = document.getElementById("reproScore");
const crossScoreEl = document.getElementById("crossScore");
const detailScoreEl = document.getElementById("detailScore");
const principleNoteEl = document.getElementById("principleNote");
const evidenceEl = document.getElementById("evidence");
const gdeltSummaryEl = document.getElementById("gdeltSummary");
const llmVerdictPillEl = document.getElementById("llmVerdictPill");
const llmConfidenceEl = document.getElementById("llmConfidence");
const llmRationaleEl = document.getElementById("llmRationale");
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
const minLoadingMs = 700;
const gdeltMinIntervalMs = 5200;
const gdeltCacheTtlMs = 15 * 60 * 1000;

localModeButtonEl.addEventListener("click", () => {
  void requestRun();
});

function setStatus(text) {
  statusEl.textContent = text;
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
    statusEl.classList.add("thinking");
    setStatus("正在调用本地 AI");
    thinkingTextEl.textContent = "正在分析文本、搜索 GDELT 新闻并生成本地结论";
    updateModeButtons();
    return;
  }

  const elapsed = performance.now() - loadingStartAt;
  const remaining = Math.max(0, minLoadingMs - elapsed);
  loadingHideTimer = window.setTimeout(() => {
    thinkingBannerEl.classList.remove("active");
    statusEl.classList.remove("thinking");
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
}

function renderRuleScores(ruleScores, ruleNotes, extraContext = {}) {
  const scores = normalizeRuleScores(ruleScores);
  reproScoreEl.textContent = formatScore(scores.reproducibility);
  crossScoreEl.textContent = formatScore(scores.cross_validation);
  detailScoreEl.textContent = formatScore(scores.detail_richness);

  const notes = [];
  if (extraContext.specificity) notes.push(`具体性：${extraContext.specificity}`);
  if (extraContext.cross_validation) notes.push(`交叉验证：${extraContext.cross_validation}`);
  if (extraContext.reproducibility) notes.push(`可重复性：${extraContext.reproducibility}`);
  if (ruleNotes?.reproducibility) notes.push(`可重复性：${ruleNotes.reproducibility}`);
  if (ruleNotes?.cross_validation) notes.push(`交叉验证：${ruleNotes.cross_validation}`);
  if (ruleNotes?.detail_richness) notes.push(`内容具体性：${ruleNotes.detail_richness}`);
  principleNoteEl.textContent = notes.length > 0 ? notes.join(" · ") : "—";
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

  const availability = await api.availability({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  });

  if (availability !== "available" && !allowDownload) {
    throw new Error("Chrome 本地 AI 需要先就绪，请点击“本地 AI”按钮后再试");
  }

  gdeltSummaryEl.textContent = "正在搜索 GDELT 相关新闻…";
  const gdeltBundle = await fetchGdeltBundle(input, signal);
  gdeltSummaryEl.textContent = gdeltBundle.summary || "—";
  const mbfcEntry = await lookupMbfcEntry(input.url || "");
  const session = await api.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    signal
  });

  const prompt = buildLocalPrompt(input, gdeltBundle, mbfcEntry);
  const raw = await session.prompt(prompt);
  const parsed = parseAssessmentJson(raw);
  if (!parsed) {
    return {
      verdict: "unclear",
      confidence: 0,
      summary: raw?.trim() || "本地 AI 未返回可解析结果",
      rationale: raw?.trim() || "本地 AI 未返回可解析结果",
      rule_scores: null,
      rule_notes: null,
      evidence: mergeEvidenceLists(buildFallbackEvidence(input), gdeltBundle.items, input),
      conflicts: [],
      missing: ["本地 AI 输出格式不符合预期"],
      gdelt_summary: gdeltBundle.summary,
      reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry),
      cross_validation_summary: buildCrossValidationSummary(gdeltBundle),
      specificity_summary: buildSpecificitySummary(input)
    };
  }

  const ruleScores = normalizeRuleScores(parsed.rule_scores);
  const overallScore = normalizeConfidence(parsed.overall_score ?? averageRuleScores(ruleScores));
  return {
    verdict: normalizeVerdict(parsed.verdict || verdictFromScore(overallScore)),
    confidence: overallScore,
    summary: String(parsed.summary || parsed.rationale || "本地 AI 已完成分析"),
    rationale: String(parsed.rationale || parsed.summary || "本地 AI 已完成分析"),
    rule_scores: ruleScores,
    rule_notes: normalizeRuleNotes(parsed.rule_notes),
    evidence: mergeEvidenceLists(normalizeEvidence(parsed.evidence, input), gdeltBundle.items, input),
    conflicts: normalizeList(parsed.conflicts),
    missing: normalizeList(parsed.missing),
    gdelt_summary: gdeltBundle.summary,
    reproducibility_summary: buildReproducibilitySummary(gdeltBundle, mbfcEntry),
    cross_validation_summary: buildCrossValidationSummary(gdeltBundle),
    specificity_summary: buildSpecificitySummary(input)
  };
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
    mode,
    gdelt_summary: ""
  };
}

function buildLocalPrompt(input, gdeltBundle, mbfcEntry) {
  const analysisText = getAnalysisText(input);
  const specificitySummary = buildSpecificitySummary(input);
  const crossValidationSummary = buildCrossValidationSummary(gdeltBundle);
  const reproducibilitySummary = buildReproducibilitySummary(gdeltBundle, mbfcEntry);
  const gdeltLines = Array.isArray(gdeltBundle?.items) && gdeltBundle.items.length > 0
    ? gdeltBundle.items.map((item, index) => {
        const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
        const source = item.source || item.source_type || "GDELT";
        const country = item.country ? ` · ${item.country}` : "";
        const tone = item.tone ? ` · tone=${item.tone}` : "";
        const quote = item.quote || "";
        return `${index + 1}. ${date}${country}${tone} · ${source} · ${item.title || item.url || "GDELT 命中"}${quote ? `\n   ${quote}` : ""}`;
      }).join("\n")
    : "本次查询没有找到足够接近的 GDELT 新闻事件。";
  const gdeltQueryLine = gdeltBundle?.query ? `GDELT 查询词：${gdeltBundle.query}` : "GDELT 查询词：(空)";
  const gdeltAnchorLine = gdeltBundle?.anchorDate ? `GDELT 锚定日期：${gdeltBundle.anchorDate}` : "GDELT 锚定日期：(无)";
  return [
    "你是一个金融信息核验助手，只能基于下方提供的文本、GDELT 证据和你训练中已有的知识进行判断，不要联网，不要编造外部事实。",
    "请严格按三原则思考，并分别给出分数与结论：",
    "1) 信息具体性：看声明本身的密度和可证伪性。重点关注 DIKW 层级、5W1H 完整度、数据与结论的相关性、细节是否精确、信息熵是否低。",
    "2) 交叉验证：看声明是否被独立来源印证。重点关注 GDELT 的独立域名数、来源国家分布、报道口径一致性（tone）、以及是否符合基础科学知识。",
    "3) 可重复性：看声明在时间轴上的稳定性和信源可信度。重点关注 MBFC 域名信誉、GDELT 中该事件的持续出现、首次/最近出现时间、以及是否长期被不同来源重复印证。",
    "GDELT 证据是交叉验证的主要输入；MBFC 只用于可重复性和信源可信度。",
    "Return ONLY valid JSON with these keys:",
    '{ "verdict": "supported|contradicted|unclear", "confidence": 0.0, "overall_score": 0.0, "summary": "short Chinese summary", "rationale": "short Chinese explanation", "rule_scores": {"reproducibility": 0.0, "cross_validation": 0.0, "detail_richness": 0.0}, "rule_notes": {"reproducibility": "...", "cross_validation": "...", "detail_richness": "..."}, "evidence": [{"title":"...", "url":"...", "quote":"..."}], "conflicts": ["..."], "missing": ["..."] }',
    "Rules:",
    "- verdict 必须反映这条声明整体可信度。",
    "- confidence 和 overall_score 必须是 0 到 1 之间的数字。",
    "- rule_scores 必须分别对应三原则：reproducibility、cross_validation、detail_richness。",
    "- rule_notes 需要简短说明每个分数为什么这样打，并且尽量引用 GDELT/MBFC 线索。",
    "- evidence 里的 quote 要尽量是原文或证据中的精确片段。",
    "- 如果声明太弱、太空、或者无法验证，请返回 unclear。",
    "",
    `URL: ${input.url || ""}`,
    `Title: ${input.title || ""}`,
    `Selection: ${input.selectionText || ""}`,
    "Page text:",
    analysisText || input.pageText || input.selectionText || "",
    "",
    gdeltQueryLine,
    gdeltAnchorLine,
    "信息具体性线索：",
    specificitySummary,
    "",
    "交叉验证线索：",
    crossValidationSummary,
    "",
    "可重复性线索：",
    reproducibilitySummary,
    "",
    "GDELT evidence bundle:",
    gdeltLines
  ].join("\n");
}

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

function buildReproducibilitySummary(gdeltBundle, mbfcEntry) {
  const lines = [];
  if (mbfcEntry) {
    lines.push(`MBFC：${mbfcEntry.hostname}${mbfcEntry.rating ? ` · ${mbfcEntry.rating}` : ""}${mbfcEntry.label ? ` · ${mbfcEntry.label}` : ""}`);
  } else {
    lines.push("MBFC：未命中静态数据或尚未打包该域名。");
  }

  if (gdeltBundle?.items?.length) {
    const firstDate = gdeltBundle.items[gdeltBundle.items.length - 1]?.retrieved_at || "";
    const lastDate = gdeltBundle.items[0]?.retrieved_at || "";
    const domains = countDistinctValues(gdeltBundle.items.map((item) => item.domain).filter(Boolean));
    lines.push(`GDELT 时间线：首次 ${formatDateOnly(firstDate)} · 最近 ${formatDateOnly(lastDate)} · 独立域名 ${domains}`);
  } else {
    lines.push("GDELT 时间线：未找到可用新闻事件。");
  }

  lines.push("判断要点：如果信源长期稳定、重复出现且域名信誉较好，可重复性更高。");
  return lines.join("\n");
}

function buildCrossValidationSummary(gdeltBundle) {
  const items = Array.isArray(gdeltBundle?.items) ? gdeltBundle.items : [];
  if (items.length === 0) {
    return "GDELT 交叉验证：无可用新闻事件，独立来源印证不足。";
  }

  const domains = countDistinctValues(items.map((item) => item.domain).filter(Boolean));
  const countries = countDistinctValues(items.map((item) => item.country).filter(Boolean));
  const tones = summarizeCounts(items.map((item) => item.tone).filter(Boolean));
  const timeline = `${formatDateOnly(items[items.length - 1]?.retrieved_at)} → ${formatDateOnly(items[0]?.retrieved_at)}`;
  return [
    `GDELT 交叉验证：命中 ${items.length} 条，独立域名 ${domains}，来源国家 ${countries}`,
    tones ? `口径/tone：${tones}` : "口径/tone：未提供",
    `时间范围：${timeline}`,
    "判断要点：如果多域名、多国家、口径一致，交叉验证更强。"
  ].join("\n");
}

function buildSpecificitySummary(input) {
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

  const diwk = `DIKW：信息/知识密度以“可核查细节 + 明确数据 + 明确因果”为主，当前文本长度 ${words.length} 词，数字 ${numbers.length} 个，日期 ${dates.length} 个。`;
  const fiveW1H = `5W1H：谁=${yesNo(who)}，什么=${yesNo(what)}，何时=${yesNo(when)}，何地=${yesNo(where)}，为什么=${yesNo(why)}，如何=${yesNo(how)}。`;
  const relation = "数据与结论相关性：若数据只是在旁边出现、未支撑结论、或关键变量缺失，则具体性应打低分。";
  const bayes = "贝叶斯启发：细节越精确、数值越具体、条件越完整，信息熵越低，结论越可验证。";
  return [diwk, fiveW1H, relation, bayes].join("\n");
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

async function fetchGdeltBundle(input, signal) {
  const queries = buildGdeltQueries(input);
  const anchorDate = extractAnchorDate(input);
  const query = queries[0] || "";
  if (!query) {
    return {
      query: "",
      items: [],
      anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
      summary: summarizeGdeltBundle("", [], "", anchorDate)
    };
  }

  const cacheKey = buildGdeltCacheKey(input, query, anchorDate);
  const cached = await getGdeltCachedBundle(cacheKey);
  if (cached) {
    return {
      ...cached,
      summary: summarizeGdeltBundle(query, cached.items || [], cached.errorMessage || "", anchorDate)
    };
  }

  const result = await enqueueGdeltRequest(() => fetchGdeltItems(query, signal));
  const topItems = sortGdeltItems(result.items, anchorDate).slice(0, 5);
  const bundle = {
    query,
    items: topItems,
    anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : "",
    errorMessage: result.errorMessage || "",
    summary: summarizeGdeltBundle(query, topItems, result.errorMessage, anchorDate)
  };
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
    if (resp.status === 429) {
      return {
        items: [],
        errorMessage: `GDELT 访问过于频繁，请稍后再试（${resp.status}${text ? ` - ${text}` : ""}）`
      };
    }
    throw new Error(`GDELT HTTP ${resp.status}${text ? ` - ${text}` : ""}`);
  }

  const data = await resp.json();
  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.feed?.items)
      ? data.feed.items
      : [];

  return {
    items: rawItems.map(normalizeGdeltItem).filter((item) => item.title || item.url),
    errorMessage: ""
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

function summarizeGdeltBundle(query, items, errorMessage, anchorDate) {
  if (errorMessage && items.length === 0) {
    return `GDELT 检索失败：${errorMessage}`;
  }

  if (!items || items.length === 0) {
    return query
      ? `GDELT 近 30 天未找到相近新闻事件（关键词：${query}）。`
      : "GDELT 近 30 天未找到相近新闻事件。";
  }

  const lines = items.slice(0, 3).map((item) => {
    const date = item.retrieved_at ? new Date(item.retrieved_at).toISOString().slice(0, 10) : "unknown-date";
    const source = item.source ? ` · ${item.source}` : "";
    return `${date}${source} · ${item.title}`;
  });
  const queryLine = query ? `GDELT 查询词：${query}\n` : "";
  const anchorLine = anchorDate
    ? `GDELT 锚定日期：${anchorDate.toISOString().slice(0, 10)}\n`
    : "";
  return `${queryLine}${anchorLine}GDELT 近 30 天命中 ${items.length} 条；最近事件：\n${lines.join("\n")}`;
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

function buildGdeltQueries(input) {
  const candidates = [];
  const selection = String(input?.selectionText || "").trim();
  const title = String(input?.title || "").trim();
  const pageText = String(input?.pageText || "").trim();

  if (selection) {
    if (selection.length <= 160) {
      candidates.push(selection);
    } else {
      const selectionKeywords = extractGdeltKeywords(selection);
      if (selectionKeywords.length > 0) {
        candidates.push(selectionKeywords.slice(0, 6).join(" "));
      }
    }
  }

  const combined = [selection, title, pageText.slice(0, 1200)].filter(Boolean).join(" ");
  const keywords = extractGdeltKeywords(combined);
  if (keywords.length > 0) {
    candidates.push(keywords.slice(0, 6).join(" "));
  }

  const titleKeywords = extractGdeltKeywords(title);
  if (titleKeywords.length > 0) {
    candidates.push(titleKeywords.slice(0, 5).join(" "));
  }

  const fallback = extractGdeltKeywords(pageText);
  if (fallback.length > 0) {
    candidates.push(fallback.slice(0, 4).join(" "));
  }

  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))].slice(0, 4);
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
  const phrases = phraseMatches.map((item) => item.replace(/^"|"$/g, "").trim()).filter(Boolean);

  const tokens = normalized
    .split(/[^A-Za-z0-9.$%+/:-]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 2)
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
