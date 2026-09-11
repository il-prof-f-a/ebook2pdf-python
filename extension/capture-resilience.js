(() => {
  let targetTabId = null;
  let targetWindowId = null;
  let waitingLogged = false;
  let pausedStepText = "";

  const currentActiveTab = activeTab;
  const READ_ONLY_MESSAGES = new Set([
    "PING",
    "PING_READINESS",
    "GET_VIEWPORT",
    "GET_RENDER_STATE",
    "GET_RENDER_STATE_V2"
  ]);

  function errorText(value) {
    return String(value?.message || value || "");
  }

  function isActiveTabPermissionError(value) {
    const message = errorText(value);
    return /activeTab/i.test(message) && /not in effect|not been invoked|permission/i.test(message);
  }

  function isMessageChannelError(value) {
    const message = errorText(value);
    return (
      /message channel closed/i.test(message) ||
      /port closed before a response/i.test(message) ||
      /receiving end does not exist/i.test(message) ||
      /could not establish connection/i.test(message)
    );
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

  async function waitForMessageChannel(tabId, maxWaitMs = 10000) {
    const started = Date.now();
    while (!stopRequested && Date.now() - started < maxWaitMs) {
      await waitForTargetTabActive();
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
        if (response?.ok) return true;
      } catch (_) {}
      await sleep(500);
    }
    return false;
  }

  function wrapMessageChannelError(error, message) {
    const wrapped = new Error(errorText(error) || "Canale di comunicazione con la pagina interrotto.");
    wrapped.cause = error;
    wrapped.ebook2pdfMessageChannelClosed = true;
    wrapped.ebook2pdfActionUncertain = message?.type === "CLICK_NEXT";
    return wrapped;
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

      if (!isMessageChannelError(error)) throw error;

      // I messaggi di sola lettura sono idempotenti: attendiamo fino a 10 s che
      // il content script torni disponibile e poi li ripetiamo automaticamente.
      if (READ_ONLY_MESSAGES.has(message?.type)) {
        log("Canale con la pagina temporaneamente interrotto: attendo il ripristino automatico…");
        const recovered = await waitForMessageChannel(tab.id, 10000);
        if (recovered) {
          log("Canale con la pagina ripristinato: continuo l'acquisizione.");
          return chrome.tabs.sendMessage(tab.id, message);
        }
      }

      // CLICK_NEXT non viene mai ripetuto alla cieca: il click può essere stato
      // eseguito anche se la risposta è andata persa. Il livello acquisizione
      // verificherà prima se la pagina è già cambiata.
      throw wrapMessageChannelError(error, message);
    }
  };

  captureVisible = async function resilientCaptureVisible() {
    let channelRetryStarted = null;

    while (!stopRequested) {
      const tab = await waitForTargetTabActive();
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          type: "CAPTURE_VISIBLE_TAB",
          tabId: tab.id,
          windowId: tab.windowId
        });
        channelRetryStarted = null;
      } catch (error) {
        if (isMessageChannelError(error)) {
          if (channelRetryStarted == null) {
            channelRetryStarted = Date.now();
            log("Canale di cattura temporaneamente interrotto: attendo il ripristino automatico…");
          }
          if (Date.now() - channelRetryStarted < 10000) {
            await sleep(500);
            continue;
          }
          throw wrapMessageChannelError(error, { type: "CAPTURE_VISIBLE_TAB" });
        }
        throw error;
      }

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
    },
    isMessageChannelError
  };
})();