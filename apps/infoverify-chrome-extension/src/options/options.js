const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com/*";
const analysisModeEl = document.getElementById("analysisMode");
const outputLanguageEl = document.getElementById("outputLanguage");
const cloudApiKeyEl = document.getElementById("cloudApiKey");
const cloudModelEl = document.getElementById("cloudModel");
const saveStatusEl = document.getElementById("saveStatus");
const cloudFieldsEl = document.getElementById("cloudFields");

// The Gemini key and model fields are only editable in Cloud AI mode.
function syncCloudFields() {
  cloudFieldsEl.disabled = analysisModeEl.value !== "cloud";
}

async function loadSettings() {
  // Mode and output language are non-secret preferences: keep them in sync storage.
  const { analysisMode = "local", outputLanguage = "auto" } = await chrome.storage.sync.get({
    analysisMode: "local",
    outputLanguage: "auto"
  });
  analysisModeEl.value = analysisMode === "cloud" ? "cloud" : "local";
  syncCloudFields();
  outputLanguageEl.value = String(outputLanguage || "auto");

  // The API key is a secret: keep it in local storage only (never synced).
  const { cloudApiKey = "", cloudModel = "" } = await chrome.storage.local.get({
    cloudApiKey: "",
    cloudModel: ""
  });
  cloudApiKeyEl.value = String(cloudApiKey || "");
  cloudModelEl.value = String(cloudModel || "");
}

function flashSaved() {
  saveStatusEl.textContent = "Saved";
  window.setTimeout(() => {
    if (saveStatusEl.textContent === "Saved") {
      saveStatusEl.textContent = "";
    }
  }, 1500);
}

// Cloud mode needs host permission for the Gemini API. The select's change
// event carries the user gesture that chrome.permissions.request requires; if
// the user declines, fall back to local mode.
async function saveAnalysisMode() {
  const wantsCloud = analysisModeEl.value === "cloud";
  // Enable the key field right away rather than after the permission prompt.
  syncCloudFields();
  const granted = wantsCloud
    ? await chrome.permissions.request({ origins: [GEMINI_ORIGIN] }).catch(() => false)
    : true;
  const analysisMode = wantsCloud && granted ? "cloud" : "local";
  analysisModeEl.value = analysisMode;
  syncCloudFields();
  await chrome.storage.sync.set({ analysisMode });

  if (!granted) {
    saveStatusEl.textContent = "Cloud AI needs permission to connect to the Gemini API; staying on Local AI.";
  } else if (analysisMode === "cloud" && !cloudApiKeyEl.value.trim()) {
    saveStatusEl.textContent = "Saved. Add your Gemini API key below to use Cloud AI.";
  } else {
    flashSaved();
  }
}

async function saveLanguage() {
  await chrome.storage.sync.set({
    outputLanguage: outputLanguageEl.value || "auto"
  });
  flashSaved();
}

async function saveCloud() {
  await chrome.storage.local.set({
    cloudApiKey: cloudApiKeyEl.value.trim(),
    cloudModel: cloudModelEl.value.trim()
  });
  flashSaved();
}

analysisModeEl.addEventListener("change", () => {
  void saveAnalysisMode();
});
outputLanguageEl.addEventListener("change", () => {
  void saveLanguage();
});
cloudApiKeyEl.addEventListener("change", () => {
  void saveCloud();
});
cloudModelEl.addEventListener("change", () => {
  void saveCloud();
});

// Local mode is the default, so start disabled until settings load.
syncCloudFields();
loadSettings().catch(() => {
  saveStatusEl.textContent = "Failed to load settings";
});
