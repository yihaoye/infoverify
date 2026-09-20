const MENU_ID_VERIFY = "infoverify.verifySelection";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_ID_VERIFY,
    title: "Fact Check the Info",
    contexts: ["selection", "page"]
  });

  if (chrome.sidePanel?.setOptions) {
    await chrome.sidePanel.setOptions({
      enabled: true,
      path: "src/panel/panel.html"
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId !== MENU_ID_VERIFY) return;

  try {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch {
    // Side panel may already be open.
  }

  const input = await captureInput(tab, info);
  const mode = "local";
  const runId = crypto.randomUUID();

  const verification = {
    state: "loading",
    mode,
    runId,
    input,
    startedAt: Date.now()
  };

  await chrome.storage.session.set({ currentVerification: verification });
  broadcastToTab(tab.id, {
    type: "VERIFY_STARTED",
    payload: verification
  });
});

async function captureInput(tab, info) {
  const fallback = {
    selectionText: info.selectionText?.trim() || "",
    url: tab.url || "",
    title: tab.title || "",
    pageText: "",
    capturedAt: new Date().toISOString()
  };

  try {
    const context = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT" });
    return normalizeInput(context, fallback);
  } catch {
    return fallback;
  }
}

function normalizeInput(context, fallback) {
  const selectionText = context?.selectionText?.trim?.() || fallback.selectionText;
  const url = context?.url?.trim?.() || fallback.url;
  const title = context?.title?.trim?.() || fallback.title;
  const pageText = context?.pageText?.trim?.() || fallback.pageText;

  return {
    selectionText,
    url,
    title,
    pageText,
    capturedAt: fallback.capturedAt
  };
}

function broadcastToTab(tabId, message) {
  chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
}
