// ---------- Panel entry point: wires UI events and Chrome messaging ----------
import { DEBUG_PREFIX } from "./modules/constants.js";
import { state } from "./modules/state.js";
import { rerunButtonEl, settingsButtonEl, downloadModelButtonEl } from "./modules/dom.js";
import { updateModePill, renderVerification } from "./modules/render.js";
import {
  requestRun,
  startVerification,
  hydrateInitialState,
  getPreferredAnalysisMode
} from "./modules/verification.js";
import { getModelAvailability, downloadModel } from "./modules/model.js";
import { reportError, setStatus } from "./modules/logging.js";

// ---------- UI events ----------
// Re-checks the current selection with the mode chosen in Settings. The click
// is the user gesture that a first-time local model download requires.
rerunButtonEl.addEventListener("click", async () => {
  const started = await requestRun(await getPreferredAnalysisMode());
  if (!started) {
    setStatus("Select text on a page, then right-click “Fact Check the Info”.");
    return;
  }
  refreshModelButton().catch(() => {});
});

settingsButtonEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Reflects the local model's download state on the dedicated button: hidden when
// the model is ready, disabled when unsupported, actionable when a download is
// needed.
async function refreshModelButton() {
  if (!downloadModelButtonEl) return;
  const availability = await getModelAvailability();
  if (availability === "available") {
    downloadModelButtonEl.hidden = true;
    return;
  }
  downloadModelButtonEl.hidden = false;
  if (availability === "unavailable") {
    downloadModelButtonEl.disabled = true;
    downloadModelButtonEl.textContent = "Local AI unavailable";
  } else {
    downloadModelButtonEl.disabled = false;
    downloadModelButtonEl.textContent =
      availability === "downloading" ? "Resume model download" : "Download local AI";
  }
}

downloadModelButtonEl?.addEventListener("click", async () => {
  downloadModelButtonEl.disabled = true;
  try {
    await downloadModel({
      onProgress: (percent) => {
        downloadModelButtonEl.textContent = `Downloading… ${percent}%`;
      }
    });
    downloadModelButtonEl.textContent = "Model ready";
    downloadModelButtonEl.hidden = true;
  } catch (err) {
    reportError("downloadModel", err);
    downloadModelButtonEl.disabled = false;
    downloadModelButtonEl.textContent = "Download failed — retry";
  }
});

// Settings apply to the next run; point at ⟳ when a result is already shown.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(changes.outputLanguage || changes.analysisMode)) return;
  if (changes.outputLanguage) refreshModelButton().catch(() => {});
  if (state.currentVerification?.input) {
    setStatus("Settings changed. Click ⟳ to re-check with the new settings.");
  } else if (changes.analysisMode) {
    updateModePill(changes.analysisMode.newValue);
  }
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

// ---------- Background -> panel messaging ----------
chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "VERIFY_STARTED") {
    const payload = message.payload || {};
    state.currentVerification = payload;
    updateModePill(payload.mode);
    if (payload.state === "loading" && payload.input) {
      void startVerification(payload);
    }
  }

  if (message.type === "VERIFY_RESULT") {
    const payload = message.payload || {};
    state.currentVerification = {
      ...state.currentVerification,
      state: "done",
      result: payload
    };
    renderVerification(payload);
  }
});

hydrateInitialState().catch(() => {});
refreshModelButton().catch(() => {});
