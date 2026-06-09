// ---------- Verification run lifecycle and session state hydration ----------
import { state } from "./state.js";
import { reportError } from "./logging.js";
import { formatError } from "./utils.js";
import {
  updateModeButtons,
  setLoading,
  resetResultsView,
  renderVerification
} from "./render.js";
import { runLocalAnalysis } from "./analysis.js";
import { runCloudAnalysis } from "./cloud.js";
import { normalizeResult, errorResult } from "./normalize.js";

function resolveMode(value) {
  return value === "cloud" ? "cloud" : "local";
}

export async function hydrateInitialState() {
  const { currentVerification: stored } = await chrome.storage.session.get({
    currentVerification: null
  });

  if (!stored) {
    updateModeButtons();
    return;
  }

  state.currentVerification = { ...stored };
  const storedMode = resolveMode(stored.result?.mode || stored.mode);
  updateModeButtons(storedMode);

  if (stored.state === "loading" && stored.input) {
    await startVerification({ ...stored });
    return;
  }

  if (stored.state === "done" && stored.result) {
    renderVerification({ ...stored.result });
  }
}

export async function requestRun(mode = "local") {
  const input = state.currentVerification?.input;
  if (!input) return;

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
  resetResultsView();

  try {
    const payload = mode === "cloud"
      ? await runCloudAnalysis(state.currentVerification.input, controller.signal)
      : await runLocalAnalysis(state.currentVerification.input, controller.signal);

    if (controller.signal.aborted || state.activeRun.id !== state.currentVerification.runId) return;

    const result = normalizeResult(payload, state.activeRun.mode, state.currentVerification.input);
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
