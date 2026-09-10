(() => {
  const INITIAL_SHARPNESS_ATTEMPTS = 5;

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
      "<strong>Predefinito: 0,50 (50%).</strong> La prima pagina viene campionata 5 volte per stabilire una baseline affidabile. " +
      "Dopo l'attesa minima ogni pagina deve superare il controllo di nitidezza prima che vengano valutati stabilità visiva e segnali DOM. " +
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
    let effectiveBaseline = baselineSharpness ?? sessionBaselineSharpness;

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

    // Prima pagina: senza una baseline il primo frame potrebbe essere ancora
    // offuscato. Campioniamo quindi cinque volte e prendiamo il valore di
    // nitidezza migliore come riferimento della sessione.
    if (settings.checkQuality && effectiveBaseline == null) {
      let bestSharpness = null;
      let validMeasurements = 0;

      log(
        `Pagina ${pageNumber}: calibrazione iniziale nitidezza ` +
        `(${INITIAL_SHARPNESS_ATTEMPTS} tentativi).`
      );

      for (let attempt = 1; attempt <= INITIAL_SHARPNESS_ATTEMPTS && !stopRequested; attempt++) {
        const capture = await captureRegionNow();
        lastCapture = capture;
        const quality = validateImage(capture.imageData, null, settings.sharpnessRatio);
        lastQuality = quality;

        if (quality?.sharpness != null && Number.isFinite(Number(quality.sharpness))) {
          const measured = Number(quality.sharpness);
          validMeasurements++;
          if (bestSharpness == null || measured > bestSharpness) {
            bestSharpness = measured;
          }
          log(
            `Pagina ${pageNumber}: nitidezza iniziale tentativo ${attempt}/${INITIAL_SHARPNESS_ATTEMPTS}: ` +
            `${measured.toFixed(2)}.`
          );
        } else {
          log(
            `Pagina ${pageNumber}: nitidezza iniziale tentativo ${attempt}/${INITIAL_SHARPNESS_ATTEMPTS} non valido` +
            `${quality?.reason ? ` (${quality.reason})` : ""}.`
          );
        }

        if (attempt < INITIAL_SHARPNESS_ATTEMPTS && !stopRequested) {
          await sleep(intervalMs);
        }
      }

      if (!stopRequested) {
        if (bestSharpness == null) {
          throw new Error(
            `Pagina ${pageNumber}: impossibile stabilire la baseline di nitidezza dopo ` +
            `${INITIAL_SHARPNESS_ATTEMPTS} tentativi.`
          );
        }

        sessionBaselineSharpness = bestSharpness;
        effectiveBaseline = bestSharpness;
        log(
          `Baseline nitidezza impostata a ${bestSharpness.toFixed(2)} ` +
          `(migliore di ${validMeasurements}/${INITIAL_SHARPNESS_ATTEMPTS} misurazioni valide).`
        );
      }
    }

    // Il timeout di rendering parte dopo l'attesa minima e, per la prima pagina,
    // dopo i cinque campionamenti necessari a calibrare la nitidezza.
    const deadline = performance.now() + (settings.renderMaxWait * 1000);

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
