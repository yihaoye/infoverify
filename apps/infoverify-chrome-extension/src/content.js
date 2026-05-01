chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "GET_SELECTION") {
    const selectionText = window.getSelection?.().toString() || "";
    sendResponse({ selectionText, url: location.href, title: document.title });
    return true;
  }
});

