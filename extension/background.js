let captureQueue = Promise.resolve();
let lastCaptureAt = 0;
const MIN_CAPTURE_INTERVAL_MS = 500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function captureVisibleTabThrottled(windowId) {
  const task = async () => {
    const elapsed = Date.now() - lastCaptureAt;
    const waitMs = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);
    if (waitMs > 0) await sleep(waitMs);

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    lastCaptureAt = Date.now();
    return dataUrl;
  };

  captureQueue = captureQueue.then(task, task);
  return captureQueue;
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
        const dataUrl = await captureVisibleTabThrottled(windowId);
        sendResponse({ ok: true, dataUrl });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});