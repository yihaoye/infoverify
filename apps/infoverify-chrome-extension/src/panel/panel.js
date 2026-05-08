const statusEl = document.getElementById("status");
const thinkingBannerEl = document.getElementById("thinkingBanner");
const thinkingTextEl = document.getElementById("thinkingText");
const verdictPillEl = document.getElementById("verdictPill");
const confidenceEl = document.getElementById("confidence");
const summaryEl = document.getElementById("summary");
const evidenceEl = document.getElementById("evidence");
const llmVerdictPillEl = document.getElementById("llmVerdictPill");
const llmConfidenceEl = document.getElementById("llmConfidence");
const llmRationaleEl = document.getElementById("llmRationale");
let loadingStartAt = 0;
let loadingHideTimer = 0;
const minLoadingMs = 700;

function setStatus(text) {
  statusEl.textContent = text;
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
    statusEl.textContent = "正在推理";
    thinkingTextEl.textContent = "正在分析文本、抓取证据并生成结论";
  } else {
    const elapsed = performance.now() - loadingStartAt;
    const remaining = Math.max(0, minLoadingMs - elapsed);
    loadingHideTimer = window.setTimeout(() => {
      thinkingBannerEl.classList.remove("active");
      statusEl.classList.remove("thinking");
      thinkingTextEl.textContent = "已完成";
      loadingHideTimer = 0;
    }, remaining);
  }
}

async function hydrateInitialState() {
  const { currentVerification } = await chrome.storage.session.get({
    currentVerification: null
  });

  if (currentVerification?.state === "loading") {
    setLoading(true);
    setStatus("正在推理");
    summaryEl.textContent = "—";
    setVerdict("—");
    renderEvidence([]);
    setLLMAssessment(null);
    return;
  }

  if (currentVerification?.state === "done" && currentVerification.result) {
    const payload = currentVerification.result;
    setLoading(false);
    setStatus("已完成");
    setVerdict(payload.verdict, payload.confidence);
    summaryEl.textContent = payload.summary || "—";
    renderEvidence(payload.evidence);
    setLLMAssessment(payload.backend?.llm_assessment || payload.llm_assessment);
  }
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
  const v = assess?.verdict;
  if (v === "high") llmVerdictPillEl.classList.add("good");
  else if (v === "low") llmVerdictPillEl.classList.add("bad");
  else if (v === "medium" || v === "unclear") llmVerdictPillEl.classList.add("warn");

  llmConfidenceEl.textContent =
    typeof assess?.confidence === "number" ? `置信度 ${(assess.confidence * 100).toFixed(0)}%` : "—";

  if (assess?.error) llmRationaleEl.textContent = `不可用：${assess.error}`;
  else llmRationaleEl.textContent = assess?.rationale || "—";
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

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "VERIFY_STARTED") {
    setLoading(true);
    setStatus("正在推理");
    summaryEl.textContent = "—";
    setVerdict("—");
    renderEvidence([]);
    setLLMAssessment(null);
  }

  if (message.type === "VERIFY_RESULT") {
    setLoading(false);
    setStatus("已完成");
    const payload = message.payload || {};
    setVerdict(payload.verdict, payload.confidence);
    summaryEl.textContent = payload.summary || "—";
    renderEvidence(payload.evidence);
    setLLMAssessment(payload.backend?.llm_assessment || payload.llm_assessment);
  }
});

hydrateInitialState().catch(() => {});
