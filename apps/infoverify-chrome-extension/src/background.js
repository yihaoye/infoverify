const MENU_ID_VERIFY = "infoverify.verifySelection";
const GOOGLE_NEWS_ORIGIN = "https://news.google.com/*";

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

  // Both APIs require the context-menu user gesture. Invoke them synchronously
  // before awaiting either promise; awaiting the permission prompt first loses
  // the activation required to open the side panel.
  const sidePanelOpen = chrome.sidePanel?.open
    ? chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
    : Promise.resolve();
  const googleNewsPermission = requestGoogleNewsPermission();

  await sidePanelOpen;
  const googleNewsPermissionGranted = await googleNewsPermission;

  const input = {
    ...await captureInput(tab, info),
    googleNewsPermissionGranted
  };
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

function requestGoogleNewsPermission() {
  try {
    return chrome.permissions.request({ origins: [GOOGLE_NEWS_ORIGIN] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

async function captureInput(tab, info) {
  const fallback = {
    selectionText: info.selectionText?.trim() || "",
    url: tab.url || "",
    title: tab.title || "",
    pageText: "",
    capturedAt: new Date().toISOString()
  };

  try {
    const context = await getPageContext(tab.id);
    return normalizeInput(context, fallback);
  } catch {
    return fallback;
  }
}

async function getPageContext(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "GET_CONTEXT" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, { type: "GET_CONTEXT" });
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
