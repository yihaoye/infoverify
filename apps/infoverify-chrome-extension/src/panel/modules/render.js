// ---------- Panel mode buttons, loading state, and result rendering ----------
import { minLoadingMs } from "./constants.js";
import { state } from "./state.js";
import {
  statusEl,
  thinkingBannerEl,
  thinkingTextEl,
  verdictPillEl,
  confidenceEl,
  summaryEl,
  reproScoreEl,
  crossScoreEl,
  detailScoreEl,
  reproSummaryEl,
  reproNoteEl,
  crossSummaryEl,
  crossNoteEl,
  detailSummaryEl,
  detailNoteEl,
  evidenceEl,
  gdeltSummaryEl,
  llmVerdictPillEl,
  llmConfidenceEl,
  llmRationaleEl,
  modePillEl,
  localModeButtonEl
} from "./dom.js";
import { setStatus, setDebugTrace } from "./logging.js";
import { normalizeRuleScores, formatScore } from "./normalize.js";

export function updateModeButtons() {
  localModeButtonEl.classList.add("active");
  modePillEl.textContent = "Local AI";
}

export function setLoading(loading) {
  if (loading) {
    if (state.loadingHideTimer) {
      window.clearTimeout(state.loadingHideTimer);
      state.loadingHideTimer = 0;
    }
    state.loadingStartAt = performance.now();
    thinkingBannerEl.classList.add("active");
    if (statusEl) {
      statusEl.classList.add("thinking");
      setStatus("Calling local AI...");
    }
    thinkingTextEl.textContent = "Analyzing text, searching GDELT news, and generating a local conclusion";
    updateModeButtons();
    return;
  }

  const elapsed = performance.now() - state.loadingStartAt;
  const remaining = Math.max(0, minLoadingMs - elapsed);
  state.loadingHideTimer = window.setTimeout(() => {
    thinkingBannerEl.classList.remove("active");
    if (statusEl) {
      statusEl.classList.remove("thinking");
    }
    thinkingTextEl.textContent = "Done";
    state.loadingHideTimer = 0;
  }, remaining);
}

// Clears the result cards back to their placeholder state at the start of a run.
export function resetResultsView() {
  setVerdict("—");
  summaryEl.textContent = "—";
  renderRuleScores(null, null);
  renderEvidence([]);
  gdeltSummaryEl.textContent = "—";
  setLLMAssessment(null);
  setDebugTrace("");
}

export function renderVerification(payload) {
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
  gdeltSummaryEl.textContent = payload.gdelt_summary || "—";
  setLLMAssessment(payload.llm_assessment || null);
  setDebugTrace(payload.debug_trace || payload.llm_assessment?.debug_trace || "");
}

export function renderRuleScores(ruleScores, ruleNotes, extraContext = {}) {
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

export function setVerdict(verdict, confidence) {
  verdictPillEl.className = "pill";
  verdictPillEl.textContent = verdict || "—";
  if (verdict === "supported") verdictPillEl.classList.add("good");
  else if (verdict === "contradicted") verdictPillEl.classList.add("bad");
  else if (verdict === "unclear") verdictPillEl.classList.add("warn");

  confidenceEl.textContent =
    typeof confidence === "number" ? `Confidence ${(confidence * 100).toFixed(0)}%` : "—";
}

export function setLLMAssessment(assess) {
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

export function renderEvidence(evidence) {
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
