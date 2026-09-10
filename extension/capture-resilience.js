(() => {
  let targetTabId = null;
  let targetWindowId = null;
  let waitingLogged = false;
  let pausedStepText = "";

  const currentActiveTab = activeTab;

  function isActiveTabPermissionError(value) {
    const message = String(value?.message || value || "");
    return /activeTab/i.test(message) && /not in effect|not been invoked|permission/i.test(message);
  }

  async function bindCurrentTab() {
    const tab = await currentActiveTab();
    targetTabId = tab.id;
    targetWindowId = tab.windowId;
    return tab;
  }

  async function getTargetTab() {
    if (targetTabId == null) return bindCurrentTab();
    try {
      return await chrome.tabs.get(targetTabId);
    } catch (error) {
      const wrapped = new Error("La scheda del documento è stata chiusa o non è più disponibile.");
      wrapped.cause = error;
      wrapped.ebook2pdfTargetUnavailable = true;
      throw wrapped;
    }
  }

  function announceWait(permissionPending = false) {
    if (waitingLogged) return;
    waitingLogged = true;
    pausedStepText = document.getElementById("stepText")?.textContent || "";
    log(
      permissionPending
        ? "Acquisizione in pausa: riporta il focus sulla scheda del documento e, se necessario, clicca nuovamente l'icona Ebook2PDF per riattivare il permesso activeTab."
        : "Acquisizione in pausa: riporta il focus sulla scheda del documento. Riprenderò automaticamente senza perdere le pagine già acquisite."
    );
    setStep("In attesa della scheda del documento…");
  }

  function announceResume() {
    if (!waitingLogged) return;
    waitingLogged = false;
    log("Scheda del documento nuovamente attiva: riprendo l'acquisizione.");
    if (pausedStepText) setStep(pausedStepText);
    pausedStepText = "";
  }

  async function waitForTargetTabActive() {
    while (!stopRequested) {
      const tab = await getTargetTab();
      if (tab.active && tab.windowId === targetWindowId) {
        announceResume();
        return tab;
      }
      announceWait(false);
      await sleep(500);
    }

    const error = new Error("Arresto richiesto dall'utente.");
    error.ebook2pdfStop = true;
    throw error;
  }

  sendToTab = async function resilientSendToTab(message) {
    if (message?.type === "SELECT_REGION") {
      await bindCurrentTab();
    } else if (targetTabId == null) {
      await bindCurrentTab();
    }

    const tab = await waitForTargetTabActive();
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      // Un cambio di focus può avvenire fra il controllo e l'invio del messaggio.
      const refreshed = await getTargetTab();
      if (!refreshed.active) {
        announceWait(false);
        await waitForTargetTabActive();
        return chrome.tabs.sendMessage(targetTabId, message);
      }
      throw error;
    }
  };

  captureVisible = async function resilientCaptureVisible() {
    while (!stopRequested) {
      const tab = await waitForTargetTabActive();
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_VISIBLE_TAB",
        tabId: tab.id,
        windowId: tab.windowId
      });

      if (response?.ok) {
        announceResume();
        return response.dataUrl;
      }

      if (response?.waitingForTab || isActiveTabPermissionError(response?.error)) {
        announceWait(Boolean(response?.permissionPending));
        await sleep(500);
        continue;
      }

      if (response?.targetUnavailable) {
        const error = new Error(response?.error || "Scheda del documento non disponibile.");
        error.ebook2pdfTargetUnavailable = true;
        throw error;
      }

      throw new Error(response?.error || "Cattura non riuscita");
    }

    const error = new Error("Arresto richiesto dall'utente.");
    error.ebook2pdfStop = true;
    throw error;
  };

  globalThis.Ebook2PdfCaptureSession = {
    async getTargetTab() {
      return getTargetTab();
    },
    get targetTabId() {
      return targetTabId;
    },
    get targetWindowId() {
      return targetWindowId;
    }
  };
})();