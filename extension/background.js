let captureQueue = Promise.resolve();
let lastCaptureAt = 0;
const MIN_CAPTURE_INTERVAL_MS = 500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isActiveTabPermissionError(error) {
  const message = String(error?.message || error || "");
  return /activeTab/i.test(message) && /not in effect|not been invoked|permission/i.test(message);
}

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

async function captureVisibleTabThrottled(windowId, expectedTabId = null) {
  const task = async () => {
    const elapsed = Date.now() - lastCaptureAt;
    const waitMs = Math.max(0, MIN_CAPTURE_INTERVAL_MS - elapsed);
    if (waitMs > 0) await sleep(waitMs);

    if (expectedTabId != null) {
      try {
        const target = await chrome.tabs.get(expectedTabId);
        if (!target?.active || target.windowId !== windowId) {
          return {
            ok: false,
            waitingForTab: true,
            error: "La scheda del documento non è attiva."
          };
        }
      } catch (error) {
        return {
          ok: false,
          targetUnavailable: true,
          error: `Scheda del documento non disponibile: ${String(error)}`
        };
      }
    }

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      lastCaptureAt = Date.now();
      return { ok: true, dataUrl };
    } catch (error) {
      if (isActiveTabPermissionError(error)) {
        return {
          ok: false,
          waitingForTab: true,
          permissionPending: true,
          error: String(error)
        };
      }
      return { ok: false, error: String(error) };
    }
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
        const windowId = Number.isInteger(message.windowId)
          ? message.windowId
          : (sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT);
        const expectedTabId = Number.isInteger(message.tabId) ? message.tabId : null;
        const result = await captureVisibleTabThrottled(windowId, expectedTabId);
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
});