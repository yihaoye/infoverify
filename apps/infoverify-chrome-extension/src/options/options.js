const delayEl = document.getElementById("delay");
const apiBaseUrlEl = document.getElementById("apiBaseUrl");
const enableLLMEl = document.getElementById("enableLLM");
const saveEl = document.getElementById("save");
const okEl = document.getElementById("ok");

async function load() {
  const { mockDelayMs, apiBaseUrl, enableLLMAssessment } = await chrome.storage.sync.get({
    mockDelayMs: 0,
    apiBaseUrl: "http://localhost:8080",
    enableLLMAssessment: false
  });
  delayEl.value = String(mockDelayMs);
  apiBaseUrlEl.value = String(apiBaseUrl);
  enableLLMEl.checked = Boolean(enableLLMAssessment);
}

async function save() {
  const value = Number(delayEl.value);
  const apiBaseUrl = String(apiBaseUrlEl.value || "").trim() || "http://localhost:8080";
  await chrome.storage.sync.set({
    mockDelayMs: Number.isFinite(value) ? value : 0,
    apiBaseUrl,
    enableLLMAssessment: Boolean(enableLLMEl.checked)
  });
  okEl.textContent = "已保存";
  setTimeout(() => (okEl.textContent = ""), 1200);
}

saveEl.addEventListener("click", () => void save());
load().catch(() => {});
