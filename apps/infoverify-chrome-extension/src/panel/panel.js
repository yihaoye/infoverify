const statusEl = document.getElementById("status");
const verdictPillEl = document.getElementById("verdictPill");
const confidenceEl = document.getElementById("confidence");
const summaryEl = document.getElementById("summary");
const evidenceEl = document.getElementById("evidence");
const rawEl = document.getElementById("raw");
const llmVerdictPillEl = document.getElementById("llmVerdictPill");
const llmConfidenceEl = document.getElementById("llmConfidence");
const llmRationaleEl = document.getElementById("llmRationale");

function setStatus(text) {
  statusEl.textContent = text;
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
    setStatus("正在核实（Mock）…");
    summaryEl.textContent = "—";
    setVerdict("—");
    renderEvidence([]);
    setLLMAssessment(null);
    rawEl.textContent = "—";
  }

  if (message.type === "VERIFY_RESULT") {
    setStatus("已完成");
    const payload = message.payload || {};
    setVerdict(payload.verdict, payload.confidence);
    summaryEl.textContent = payload.summary || "—";
    renderEvidence(payload.evidence);
    setLLMAssessment(payload.backend?.llm_assessment || payload.llm_assessment);
    rawEl.textContent = JSON.stringify(payload, null, 2);
  }
});
