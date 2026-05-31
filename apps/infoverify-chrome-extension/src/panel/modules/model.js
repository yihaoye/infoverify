// ---------- Chrome built-in local AI availability and session lifecycle ----------
import { getPreferredOutputLanguage, resolveModelOutputLanguage } from "./language.js";

// The model accepts English input; output language is hinted from the user's
// preference. These hints select the same underlying model, so a download
// triggered for one language combination satisfies the others too.
function modelCapabilities(modelOutputLanguage) {
  return {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: [modelOutputLanguage] }]
  };
}

export async function getPreferredModelLanguage() {
  return resolveModelOutputLanguage(await getPreferredOutputLanguage());
}

// Returns "available" | "downloadable" | "downloading" | "unavailable".
export async function getModelAvailability() {
  const api = globalThis.LanguageModel;
  if (!api) return "unavailable";
  try {
    return await api.availability(modelCapabilities(await getPreferredModelLanguage()));
  } catch {
    return "unavailable";
  }
}

// Creates a ready-to-use local AI session.
//
// When the model has not been downloaded yet (availability "downloadable" /
// "downloading"), Chrome only allows triggering the download in response to a
// user gesture (transient activation). Callers that aren't running inside a
// gesture get a clear message pointing at the "Download local AI" button rather
// than the opaque "Requires a user gesture" error. `onDownloadProgress` receives
// an integer percentage (0–100) while a download is in progress.
export async function createLanguageModelSession(modelOutputLanguage, signal, { onDownloadProgress } = {}) {
  const api = globalThis.LanguageModel;
  if (!api) {
    throw new Error("Chrome built-in AI is unavailable; please try again later");
  }

  const capabilities = modelCapabilities(modelOutputLanguage);
  const availability = await api.availability(capabilities);
  if (availability === "unavailable") {
    throw new Error("Chrome built-in AI is unavailable on this device.");
  }

  const options = { ...capabilities, signal };
  if (availability !== "available") {
    if (!navigator.userActivation?.isActive) {
      throw new Error(
        "The local AI model needs a one-time download. Click \"Download local AI\" in this panel to start it."
      );
    }
    options.monitor = (monitor) => {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownloadProgress?.(Math.round((Number(event.loaded) || 0) * 100));
      });
    };
  }

  return await api.create(options);
}

// Forces the one-time model download from a user gesture, reporting progress via
// `onProgress`. The session is only used to drive the download, so it is released
// afterwards; the next analysis run creates its own (now instant) session.
export async function downloadModel({ onProgress } = {}) {
  const modelOutputLanguage = await getPreferredModelLanguage();
  const session = await createLanguageModelSession(modelOutputLanguage, undefined, {
    onDownloadProgress: onProgress
  });
  session.destroy?.();
}
