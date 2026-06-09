const outputLanguageEl = document.getElementById("outputLanguage");
const cloudApiKeyEl = document.getElementById("cloudApiKey");
const cloudModelEl = document.getElementById("cloudModel");
const saveStatusEl = document.getElementById("saveStatus");

async function loadSettings() {
  // Output language is a non-secret preference: keep it in sync storage.
  const { outputLanguage = "auto" } = await chrome.storage.sync.get({
    outputLanguage: "auto"
  });
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

outputLanguageEl.addEventListener("change", () => {
  void saveLanguage();
});
cloudApiKeyEl.addEventListener("change", () => {
  void saveCloud();
});
cloudModelEl.addEventListener("change", () => {
  void saveCloud();
});

loadSettings().catch(() => {
  saveStatusEl.textContent = "Failed to load settings";
});
