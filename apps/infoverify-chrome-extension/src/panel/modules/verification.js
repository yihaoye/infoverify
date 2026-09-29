// ---------- Verification run lifecycle and session state hydration ----------
import { state } from "./state.js";
import { reportError } from "./logging.js";
import { formatError } from "./utils.js";
import {
  updateModePill,
  setLoading,
  resetResultsView,
  renderVerification,
  renderPreview
} from "./render.js";
import { runLocalAnalysis } from "./analysis.js";
import { runCloudAnalysis } from "./cloud.js";
import { normalizeResult, errorResult } from "./normalize.js";

function resolveMode(value) {
  return value === "cloud" ? "cloud" : "local";
}

// The analysis mode chosen on the Options page ("local" by default).
export async function getPreferredAnalysisMode() {
  const { analysisMode = "local" } = await chrome.storage.sync.get({ analysisMode: "local" });
  return resolveMode(analysisMode);
}

export async function hydrateInitialState() {
  const { currentVerification: stored } = await chrome.storage.session.get({
    currentVerification: null
  });

  if (!stored) {
    updateModePill(await getPreferredAnalysisMode());
    return;
  }

  state.currentVerification = { ...stored };
  const storedMode = resolveMode(stored.result?.mode || stored.mode);
  updateModePill(storedMode);

  if (stored.state === "loading" && stored.input) {
    await startVerification({ ...stored });
    return;
  }

  if (stored.state === "done" && stored.result) {
    renderVerification({ ...stored.result });
  }
}

// Re-checks the current selection. Returns false when there is nothing to check.
export async function requestRun(mode = "local") {
  const input = state.currentVerification?.input;
  if (!input) return false;

  const runId = crypto.randomUUID();
  const verification = {
    state: "loading",
    mode: resolveMode(mode),
    runId,
    input,
    startedAt: Date.now()
  };

  await chrome.storage.session.set({ currentVerification: verification });
  state.currentVerification = verification;
  await startVerification(verification);
  return true;
}

export async function startVerification(verification) {
  if (!verification?.input) return;
  if (state.activeRun.id && state.activeRun.id === verification.runId) return;

  if (state.activeRun.controller) {
    state.activeRun.controller.abort();
  }

  const mode = resolveMode(verification.mode);
  const controller = new AbortController();
  state.activeRun = {
    id: verification.runId || crypto.randomUUID(),
    mode,
    controller
  };

  state.currentVerification = {
    ...verification,
    runId: state.activeRun.id,
    mode
  };
  await chrome.storage.session.set({ currentVerification: state.currentVerification });

  setLoading(true, mode);
  resetResultsView(mode);
  const startedAt = performance.now();

  try {
    const payload = mode === "cloud"
      ? await runCloudAnalysis(state.currentVerification.input, controller.signal)
      : await runLocalAnalysis(state.currentVerification.input, controller.signal, {
          onPreview: (preview) => {
            if (controller.signal.aborted || state.activeRun.id !== state.currentVerification.runId) return;
            renderPreview(normalizeResult(preview, mode, state.currentVerification.input), !preview.summary);
          }
        });

    if (controller.signal.aborted || state.activeRun.id !== state.currentVerification.runId) return;

    const result = normalizeResult(
      { ...payload, elapsed_ms: performance.now() - startedAt },
      state.activeRun.mode,
      state.currentVerification.input
    );
    state.currentVerification = {
      ...state.currentVerification,
      state: "done",
      finishedAt: Date.now(),
      result
    };
    await chrome.storage.session.set({ currentVerification: state.currentVerification });
    renderVerification(result);
  } catch (err) {
    if (controller.signal.aborted || state.activeRun.id !== state.currentVerification.runId) return;

    reportError("startVerification catch", err, {
      input: state.currentVerification.input,
      mode: state.activeRun.mode
    });

    const result = errorResult({
      input: state.currentVerification.input,
      mode: state.activeRun.mode,
      message: formatError(err)
    });
    result.elapsed_ms = performance.now() - startedAt;
    state.currentVerification = {
      ...state.currentVerification,
      state: "done",
      finishedAt: Date.now(),
      result
    };
    await chrome.storage.session.set({ currentVerification: state.currentVerification });
    renderVerification(result);
  }
}
