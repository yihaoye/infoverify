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
  saveStatusEl.textContent = "已保存";
  window.setTimeout(() => {
    if (saveStatusEl.textContent === "已保存") {
      saveStatusEl.textContent = "";
    }
  }, 1500);
}

outputLanguageEl.addEventListener("change", () => {
  void saveSettings();
});

loadSettings().catch(() => {
  saveStatusEl.textContent = "加载设置失败";
});
