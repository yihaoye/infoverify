const outputLanguageEl = document.getElementById("outputLanguage");
const saveStatusEl = document.getElementById("saveStatus");

async function loadSettings() {
  const { outputLanguage = "auto" } = await chrome.storage.sync.get({
    outputLanguage: "auto"
  });
  outputLanguageEl.value = String(outputLanguage || "auto");
}

async function saveSettings() {
  await chrome.storage.sync.set({
    outputLanguage: outputLanguageEl.value || "auto"
  });
  saveStatusEl.textContent = "Saved";
  window.setTimeout(() => {
    if (saveStatusEl.textContent === "Saved") {
      saveStatusEl.textContent = "";
    }
  }, 1500);
}

outputLanguageEl.addEventListener("change", () => {
  void saveSettings();
});

loadSettings().catch(() => {
  saveStatusEl.textContent = "Failed to load settings";
});
