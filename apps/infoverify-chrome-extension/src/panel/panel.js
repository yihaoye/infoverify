// ---------- Panel entry point: wires UI events and Chrome messaging ----------
import { DEBUG_PREFIX } from "./modules/constants.js";
import { state } from "./modules/state.js";
import { localModeButtonEl, cloudModeButtonEl, downloadModelButtonEl, debugCopyButtonEl, debugStatusEl } from "./modules/dom.js";
import { updateModeButtons, renderVerification } from "./modules/render.js";
import { requestRun, startVerification, hydrateInitialState } from "./modules/verification.js";
import { getModelAvailability, downloadModel } from "./modules/model.js";
import { isCloudConfigured } from "./modules/cloud.js";
import { reportError, setStatus } from "./modules/logging.js";

// ---------- UI events ----------
localModeButtonEl.addEventListener("click", () => {
  void requestRun("local").then(() => refreshModelButton().catch(() => {}));
});

cloudModeButtonEl?.addEventListener("click", async () => {
  if (!(await isCloudConfigured())) {
    setStatus("Add your Gemini API key in Settings to use Cloud AI.");
    chrome.runtime.openOptionsPage?.();
    return;
  }
  void requestRun("cloud");
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

debugCopyButtonEl.addEventListener("click", () => {
  if (!state.lastDebugTrace) return;
  void navigator.clipboard?.writeText?.(state.lastDebugTrace).then(() => {
    debugStatusEl.textContent = "Copied to clipboard";
    window.setTimeout(() => {
      if (debugStatusEl.textContent === "Copied to clipboard") {
        debugStatusEl.textContent = "—";
      }
    }, 1500);
  }).catch(() => {
    debugStatusEl.textContent = "Copy failed, please select and copy manually";
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

// ---------- Background -> panel messaging ----------
chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "VERIFY_STARTED") {
    const payload = message.payload || {};
    state.currentVerification = payload;
    updateModeButtons();
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
