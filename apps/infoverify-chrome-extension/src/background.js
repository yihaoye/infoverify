const MENU_ID_VERIFY = "infoverify.verifySelection";
const GOOGLE_NEWS_ORIGIN = "https://news.google.com/*";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_ID_VERIFY,
    title: "Fact Check the Info",
    contexts: ["selection"]
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
  if (!info.selectionText?.trim()) return;

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
    ...captureInput(tab, info),
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

function captureInput(tab, info) {
  return {
    selectionText: info.selectionText?.trim() || "",
    url: tab.url || "",
    title: tab.title || "",
    capturedAt: new Date().toISOString()
  };
}

function broadcastToTab(tabId, message) {
  chrome.runtime.sendMessage({ ...message, tabId }).catch(() => {});
}
