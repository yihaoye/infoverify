// ---------- Panel mode buttons, loading state, and result rendering ----------
import { minLoadingMs } from "./constants.js";
import { state } from "./state.js";
import {
  statusEl,
  elapsedEl,
  timingBreakdownEl,
  thinkingBannerEl,
  thinkingTextEl,
  verdictPillEl,
  confidenceEl,
  summaryEl,
  conclusionReasonEl,
  rationaleEl,
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
  googleNewsSummaryEl,
  googleNewsQueryEl,
  newsQueryLabelEl,
  newsSummaryLabelEl,
  modePillEl,
  localModeButtonEl,
  cloudModeButtonEl
} from "./dom.js";
import { setStatus } from "./logging.js";
import { normalizeRuleScores, formatScore } from "./normalize.js";

export function updateModeButtons(mode = "local") {
  const isCloud = mode === "cloud";
  localModeButtonEl.classList.toggle("active", !isCloud);
  if (cloudModeButtonEl) {
    cloudModeButtonEl.classList.toggle("active", isCloud);
  }
  modePillEl.textContent = isCloud ? "Cloud AI" : "Local AI";
}

export function setLoading(loading, mode = "local") {
  if (loading) {
    if (state.loadingHideTimer) {
      window.clearTimeout(state.loadingHideTimer);
      state.loadingHideTimer = 0;
    }
    state.loadingStartAt = performance.now();
    startElapsedCounter();
    thinkingBannerEl.classList.add("active");
    if (statusEl) {
      statusEl.classList.add("thinking");
      setStatus(mode === "cloud" ? "Calling cloud AI (Gemini)..." : "Calling local AI...");
    }
    thinkingTextEl.textContent = mode === "cloud"
      ? "Analyzing text, searching the web, and generating a conclusion"
      : "Analyzing text, searching Google News, and generating a local conclusion";
    updateModeButtons(mode);
    return;
  }

  stopElapsedCounter();
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

const STAGE_LABELS = {
  session: "Load model",
  inputTranslation: "Translate input",
  searchQuery: "AI search terms",
  newsFetch: "Google News",
  modelPrompt: "AI analysis",
  outputTranslation: "Translate output"
};

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Live run clock next to the status line.
function startElapsedCounter() {
  stopElapsedCounter();
  timingBreakdownEl.hidden = true;
  const tick = () => {
    elapsedEl.textContent = formatSeconds(performance.now() - state.loadingStartAt);
  };
  tick();
  state.elapsedTimer = window.setInterval(tick, 100);
}

function stopElapsedCounter() {
  if (state.elapsedTimer) {
    window.clearInterval(state.elapsedTimer);
    state.elapsedTimer = 0;
  }
}

// e.g. " (first token 3.1s · 1240 chars out)": separates prompt
// processing (time to first token) from output generation.
function formatModelStats(stats) {
  if (!stats) return "";
  const parts = [];
  if (Number.isFinite(stats.firstTokenMs)) parts.push(`first token ${formatSeconds(stats.firstTokenMs)}`);
  if (Number.isFinite(stats.outputChars)) parts.push(`${stats.outputChars} chars out`);
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

// Total run time plus a per-stage breakdown (local mode only), to show where
// the wait goes. Stages under 50 ms are omitted as noise.
function renderTimings(payload) {
  elapsedEl.textContent = payload.elapsed_ms ? formatSeconds(payload.elapsed_ms) : "";
  const timings = payload.timings || {};
  const stages = Object.entries(timings)
    .filter(([name, ms]) => STAGE_LABELS[name] && ms >= 50)
    .map(([name, ms]) => {
      const label = `${STAGE_LABELS[name]} ${formatSeconds(ms)}`;
      return name === "modelPrompt" ? `${label}${formatModelStats(timings.model)}` : label;
    });
  timingBreakdownEl.textContent = stages.join(" · ");
  timingBreakdownEl.hidden = stages.length === 0;
}

// Clears the result cards back to their placeholder state at the start of a run.
export function resetResultsView(mode = "local") {
  setVerdict("—");
  summaryEl.textContent = "—";
  rationaleEl.textContent = "—";
  conclusionReasonEl.hidden = true;
  renderRuleScores(null, null);
  renderEvidence([]);
  googleNewsQueryEl.textContent = "—";
  googleNewsSummaryEl.textContent = "—";
  newsQueryLabelEl.textContent = mode === "cloud" ? "Google Search queries" : "Google News query";
  newsSummaryLabelEl.textContent = mode === "cloud" ? "Google Search grounding" : "Google News cross-validation";
}

export function renderVerification(payload) {
  setLoading(false);
  setStatus("Done");
  renderTimings(payload);
  renderResultCards(payload);
}

// Provisional result while the model is still writing the summary. The loading
// banner and live clock keep running until renderVerification.
// `summaryPending`: no summary text has streamed in yet.
export function renderPreview(payload, summaryPending = false) {
  setStatus("Writing summary");
  renderResultCards(payload);
  if (summaryPending) summaryEl.textContent = "…";
}

function renderResultCards(payload) {
  const mode = payload?.mode === "cloud" ? "cloud" : "local";
  updateModeButtons(mode);
  setVerdict(payload.verdict, payload.confidence);
  summaryEl.textContent = payload.summary || "—";
  const rationale = String(payload.rationale || "").trim();
  const summary = String(payload.summary || "").trim();
  rationaleEl.textContent = rationale || "—";
  conclusionReasonEl.hidden = !rationale || rationale === summary;
  renderRuleScores(payload.rule_scores || null, payload.rule_notes || null, {
    specificity: payload.specificity_summary || "",
    cross_validation: payload.cross_validation_summary || "",
    reproducibility: payload.reproducibility_summary || ""
  });
  renderEvidence(payload.evidence);
  newsQueryLabelEl.textContent = mode === "cloud" ? "Google Search queries" : "Google News query";
  newsSummaryLabelEl.textContent = mode === "cloud" ? "Google Search grounding" : "Google News cross-validation";
  googleNewsQueryEl.textContent = payload.news_query || "—";
  googleNewsSummaryEl.textContent = payload.news_summary || "—";
}

export function renderRuleScores(ruleScores, ruleNotes, extraContext = {}) {
  const scores = normalizeRuleScores(ruleScores);
  reproScoreEl.textContent = formatScore(scores.reproducibility);
  crossScoreEl.textContent = formatScore(scores.cross_validation);
  detailScoreEl.textContent = formatScore(scores.detail_richness);

  reproSummaryEl.textContent = extraContext.reproducibility || "—";
  crossSummaryEl.textContent = extraContext.cross_validation || "—";
  detailSummaryEl.textContent = extraContext.specificity || "—";

  // Model-written notes only exist in cloud mode; hide the box otherwise.
  setNote(reproNoteEl, ruleNotes?.reproducibility);
  setNote(crossNoteEl, ruleNotes?.cross_validation);
  setNote(detailNoteEl, ruleNotes?.detail_richness);
}

function setNote(el, text) {
  el.textContent = text || "";
  el.hidden = !text;
}

export function setVerdict(verdict, confidence) {
  verdictPillEl.className = "pill";
  verdictPillEl.textContent = verdict || "—";
  if (verdict === "supported") verdictPillEl.classList.add("good");
  else if (verdict === "contradicted") verdictPillEl.classList.add("bad");
  else if (verdict === "unclear") verdictPillEl.classList.add("warn");

  confidenceEl.textContent =
    typeof confidence === "number" ? `Credibility ${(confidence * 100).toFixed(0)}%` : "—";
}

const STANCE_TAGS = {
  support: { label: "Supports", tone: "good" },
  contradict: { label: "Contradicts", tone: "bad" },
  irrelevant: { label: "Off-topic", tone: "" }
};
const STANCE_ORDER = { contradict: 0, support: 1, unknown: 2, irrelevant: 3 };

// Evidence URLs come from model / API output, so only web links are clickable.
function safeHref(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "#";
  } catch {
    return "#";
  }
}

export function renderEvidence(evidence) {
  evidenceEl.innerHTML = "";
  if (!Array.isArray(evidence) || evidence.length === 0) {
    evidenceEl.textContent = "—";
    return;
  }

  // Contradicting evidence first (most decision-relevant), off-topic hits last.
  const ordered = [...evidence].sort(
    (left, right) => (STANCE_ORDER[left.stance] ?? 2) - (STANCE_ORDER[right.stance] ?? 2)
  );
  for (const item of ordered) {
    const wrap = document.createElement("div");
    wrap.className = item.stance === "irrelevant" ? "evidenceItem irrelevant" : "evidenceItem";

    const title = document.createElement("div");
    title.className = "evidenceTitle";
    const tag = STANCE_TAGS[item.stance];
    if (tag) {
      const pill = document.createElement("span");
      pill.className = tag.tone ? `pill stancePill ${tag.tone}` : "pill stancePill";
      pill.textContent = tag.label;
      title.appendChild(pill);
    }
    const a = document.createElement("a");
    a.href = safeHref(item.url);
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
