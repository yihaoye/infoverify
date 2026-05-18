chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "GET_SELECTION" || message.type === "GET_CONTEXT") {
    const selectionText = window.getSelection?.().toString().trim() || "";
    const pageText = collectPageText(12000);
    sendResponse({
      selectionText,
      url: location.href,
      title: document.title,
      pageText
    });
    return true;
  }
});

function collectPageText(maxChars) {
  const raw = document.body?.innerText || document.documentElement?.innerText || "";
  const normalized = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    return description.trim().slice(0, maxChars);
  }

  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}…`;
}
