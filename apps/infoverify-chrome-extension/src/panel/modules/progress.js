// ---------- Stage-based progress bar in the "Thinking" banner ----------
import { state } from "./state.js";
import {
  thinkingTextEl,
  thinkingStepEl,
  thinkingElapsedEl,
  progressTrackEl,
  progressFillEl
} from "./dom.js";

// Expected durations (ms) are weights, roughly measured on a MacBook Air M4
// with the GPU model. They only shape the bar; stages end when the pipeline
// reports the next one, never by timer.
const STAGE_PLANS = {
  local: [
    { id: "prepare", label: "Preparing the claim", expectedMs: 800 },
    { id: "searchQuery", label: "Generating search terms", expectedMs: 6000 },
    { id: "news", label: "Searching Google News", expectedMs: 1000 },
    { id: "reading", label: "Reading the evidence", expectedMs: 4500 },
    { id: "writing", label: "Writing the conclusion", expectedMs: 9000 },
    { id: "translatingOutput", label: "Translating the result", expectedMs: 1500 }
  ],
  cloud: [
    { id: "cloud", label: "Asking Gemini with Google Search", expectedMs: 10000 }
  ]
};

const TICK_MS = 100;
// A stage fills asymptotically so the bar keeps moving but never claims a
// stage is done early: ~86% of its share at the expected duration, capped.
const STAGE_FILL_CAP = 0.95;

let run = null;

export function startProgress(mode = "local") {
  stopTicker();
  const stages = (STAGE_PLANS[mode] || STAGE_PLANS.local).map((stage) => ({ ...stage, skipped: false }));
  run = {
    stages,
    currentIndex: 0,
    stageStartedAt: performance.now(),
    startedAt: performance.now(),
    percent: 0,
    override: null
  };
  render();
  state.progressTimer = window.setInterval(render, TICK_MS);
}

// Moves to stage `id`; stages passed over without being entered are skipped.
export function setProgressStage(id) {
  if (!run) return;
  const index = run.stages.findIndex((stage) => stage.id === id);
  if (index < 0 || index < run.currentIndex) return;
  for (let i = run.currentIndex + 1; i < index; i += 1) run.stages[i].skipped = true;
  run.currentIndex = index;
  run.stageStartedAt = performance.now();
  run.override = null;
  render();
}

// Drops a stage that will not run (e.g. rule-based search terms, no output
// translation), so its share of the bar goes to the remaining stages.
export function skipProgressStage(id) {
  const stage = run?.stages.find((item) => item.id === id);
  if (stage) stage.skipped = true;
}

// Real progress for the current step, e.g. the one-time model download.
export function setProgressDetail(label, percent) {
  if (!run) return;
  run.override = { label, percent };
  render();
}

export function finishProgress() {
  stopTicker();
  if (!run) return;
  run.percent = 100;
  progressFillEl.style.width = "100%";
  progressTrackEl.setAttribute("aria-valuenow", "100");
  run = null;
}

function stopTicker() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = 0;
  }
}

function render() {
  if (!run) return;
  const now = performance.now();
  const active = run.stages.filter((stage) => !stage.skipped || stage === run.stages[run.currentIndex]);
  const current = run.stages[run.currentIndex];
  const total = active.reduce((sum, stage) => sum + stage.expectedMs, 0) || 1;
  const before = active.slice(0, active.indexOf(current)).reduce((sum, stage) => sum + stage.expectedMs, 0);
  const tau = current.expectedMs / 2;
  const within = current.expectedMs * Math.min(STAGE_FILL_CAP, 1 - Math.exp(-(now - run.stageStartedAt) / tau));

  // Monotonic: skipping stages can shrink the total, never move the bar back.
  // A detail override (model download) shows its own percentage and does not
  // count toward the stage estimate.
  run.percent = Math.max(run.percent, ((before + within) / total) * 100);
  const shown = run.override ? run.override.percent : run.percent;

  const step = active.indexOf(current) + 1;
  thinkingStepEl.textContent = active.length > 1 ? `Step ${step} of ${active.length}` : "";
  thinkingTextEl.textContent = run.override?.label || current.label;
  thinkingElapsedEl.textContent = `${((now - run.startedAt) / 1000).toFixed(1)}s`;
  progressFillEl.style.width = `${shown.toFixed(1)}%`;
  progressTrackEl.setAttribute("aria-valuenow", String(Math.round(shown)));
}
