async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      return true;
    } catch (error) {
      console.warn("Ebook2PDF: impossibile iniettare content.js", error);
      return false;
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await ensureContentScript(tab.id);
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    (async () => {
      try {
        const windowId = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});