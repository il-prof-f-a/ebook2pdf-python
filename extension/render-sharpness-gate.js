(() => {
  let blurWaitLogged = false;
  let sessionBaselineSharpness = null;

  // Mantiene la baseline interna per tutta una singola acquisizione. In questo
  // modo il gate di nitidezza funziona anche senza cambiare la firma dei chiamanti.
  const startButton = document.getElementById("start");
  startButton?.addEventListener("click", () => {
    sessionBaselineSharpness = null;
    blurWaitLogged = false;
  }, true);

  // Aggiorna il messaggio storico del log: la nitidezza non è più solo
  // diagnostica, ma viene verificata prima di interrogare il DOM.
  const originalLog = log;
  log = function sharpnessAwareLog(message) {
    let text = String(message ?? "");
    if (text.startsWith("Nitidezza diagnostica: ratio ")) {
      text = text.replace(
        /Nitidezza diagnostica: ratio ([0-9.]+) \(non causa più lo scarto della pagina\)\./,
        "Controllo nitidezza: ratio $1, verificato prima della validazione DOM."
      );
    }
    originalLog(text);
  };

  // Allinea anche l'etichetta delle impostazioni al nuovo comportamento.
  const qualityCheck = document.getElementById("checkQuality");
  if (qualityCheck?.parentElement) {
    for (const node of qualityCheck.parentElement.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /misura nitidezza/i.test(node.nodeValue || "")) {
        node.nodeValue = " verifica nitidezza e qualità prima della validazione DOM";
      }
    }
  }

  const ratioInput = document.getElementById("sharpnessRatio");
  const ratioHelp = ratioInput?.parentElement?.nextElementSibling;
  if (ratioHelp?.classList?.contains("help")) {
    ratioHelp.innerHTML =
      "<strong>Predefinito: 0,50 (50%).</strong> Dopo l'attesa minima la pagina deve superare " +
      "questo controllo di nitidezza prima che vengano valutati stabilità visiva e segnali DOM. " +
      "Serve a evitare la cattura di pagine temporaneamente offuscate durante il rendering.";
  }

  waitForRenderedPage = async function waitForRenderedPageWithSharpness(
    previousImageData,
    settings,
    pageNumber,
    baselineSharpness = null
  ) {
    const requireChange = !!previousImageData && settings.checkDuplicates;
    const changeThreshold = settings.pageChangeThresholdPct / 100;
    const stableThreshold = settings.stabilityThresholdPct / 100;
    const intervalMs = settings.stabilityInterval * 1000;
    const deadline = performance.now() + (settings.renderMaxWait * 1000);
    const effectiveBaseline = baselineSharpness ?? sessionBaselineSharpness;

    let changed = !requireChange;
    let previousFrame = null;
    let lastCapture = null;
    let lastAcceptableCapture = null;
    let lastDomState = null;
    let lastQuality = null;
    let stableComparisons = 0;
    let changeDifference = null;
    let frameDifference = null;
    let domUnavailableLogged = false;

    blurWaitLogged = false;
    await sleep(settings.delay * 1000);

    while (!stopRequested && performance.now() < deadline) {
      const capture = await captureRegionNow();
      lastCapture = capture;

      if (requireChange && !changed) {
        changeDifference = imageDifference(capture.imageData, previousImageData);
        if (changeDifference >= changeThreshold) {
          changed = true;
          previousFrame = null;
          stableComparisons = 0;
          log(`Pagina ${pageNumber}: cambio rilevato (${(changeDifference * 100).toFixed(3)}%).`);
        } else {
          await sleep(intervalMs);
          continue;
        }
      }

      // 1) NITIDEZZA / QUALITÀ
      // Viene valutata prima sia della stabilità sia del DOM. Il viewer può avere
      // già concluso le mutazioni DOM mentre il canvas della pagina è ancora blurred.
      if (settings.checkQuality) {
        lastQuality = validateImage(
          capture.imageData,
          effectiveBaseline,
          settings.sharpnessRatio
        );

        if (!lastQuality.ok) {
          previousFrame = null;
          stableComparisons = 0;

          if (!blurWaitLogged) {
            log(
              `Pagina ${pageNumber}: immagine non ancora valida (${lastQuality.reason}); ` +
              `attendo prima di verificare stabilità e DOM.`
            );
            blurWaitLogged = true;
          }

          await sleep(intervalMs);
          continue;
        }

        if (blurWaitLogged) {
          log(
            `Pagina ${pageNumber}: nitidezza rientrata nei limiti (${lastQuality.reason}); ` +
            `procedo con stabilità visiva e DOM.`
          );
          blurWaitLogged = false;
        }
      }

      lastAcceptableCapture = capture;

      // 2) STABILITÀ VISIVA
      // Confrontiamo soltanto frame che hanno già superato il gate di qualità.
      if (previousFrame) {
        frameDifference = imageDifference(capture.imageData, previousFrame.imageData);
        if (frameDifference <= stableThreshold) {
          stableComparisons++;
        } else {
          stableComparisons = 0;
        }
      }
      previousFrame = capture;

      const visualReady = stableComparisons >= settings.stableSamples;
      if (!visualReady) {
        await sleep(intervalMs);
        continue;
      }

      // 3) DOM
      // Interroghiamo il DOM solo quando il contenuto visivo è nitido e stabile.
      lastDomState = await readDomRenderState(settings);
      if (settings.useDomSignals && !lastDomState && !domUnavailableLogged) {
        log(`Pagina ${pageNumber}: segnali DOM non disponibili, uso nitidezza e stabilità visiva.`);
        domUnavailableLogged = true;
      }

      const domReady = !settings.useDomSignals || !lastDomState || lastDomState.ready;
      if (domReady) {
        if (
          settings.checkQuality &&
          sessionBaselineSharpness == null &&
          lastQuality?.sharpness != null
        ) {
          sessionBaselineSharpness = lastQuality.sharpness;
        }

        log(
          `Pagina ${pageNumber}: rendering valido ` +
          `(${stableComparisons} conferme, Δ ${(Number(frameDifference || 0) * 100).toFixed(3)}%; ` +
          `${settings.checkQuality && lastQuality ? lastQuality.reason + "; " : ""}` +
          `${domStateSummary(lastDomState)}).`
        );
        return {
          capture,
          changed,
          timedOut: false,
          stableComparisons,
          frameDifference,
          changeDifference,
          domState: lastDomState,
          quality: lastQuality
        };
      }

      await sleep(intervalMs);
    }

    if (stopRequested) {
      return {
        capture: lastAcceptableCapture || lastCapture,
        changed,
        timedOut: true,
        stableComparisons,
        frameDifference,
        changeDifference,
        domState: lastDomState,
        quality: lastQuality
      };
    }

    // Con una baseline disponibile non accettiamo una pagina rimasta sfocata fino
    // al timeout: il flusso resiliente conserva le pagine precedenti e passa a OCR/PDF.
    if (settings.checkQuality && effectiveBaseline != null && !lastAcceptableCapture) {
      throw new Error(
        `Pagina ${pageNumber}: timeout con immagine ancora non valida` +
        `${lastQuality?.reason ? ` (${lastQuality.reason})` : ""}.`
      );
    }

    if (!lastAcceptableCapture) {
      lastAcceptableCapture = await captureRegionNow();
      if (settings.checkQuality) {
        lastQuality = validateImage(
          lastAcceptableCapture.imageData,
          effectiveBaseline,
          settings.sharpnessRatio
        );
      }
    }

    if (
      settings.checkQuality &&
      sessionBaselineSharpness == null &&
      lastQuality?.sharpness != null
    ) {
      sessionBaselineSharpness = lastQuality.sharpness;
    }

    return {
      capture: lastAcceptableCapture,
      changed,
      timedOut: true,
      stableComparisons,
      frameDifference,
      changeDifference,
      domState: lastDomState,
      quality: lastQuality
    };
  };
})();
