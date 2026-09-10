(() => {
  let blurWaitLogged = false;

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

      // La qualità viene verificata PRIMA dei segnali DOM. Un viewer può infatti
      // dichiarare il DOM pronto mentre mostra ancora una pagina temporaneamente sfocata.
      if (settings.checkQuality) {
        lastQuality = validateImage(
          capture.imageData,
          baselineSharpness,
          settings.sharpnessRatio
        );

        if (!lastQuality.ok) {
          previousFrame = null;
          stableComparisons = 0;

          if (!blurWaitLogged) {
            log(
              `Pagina ${pageNumber}: immagine non ancora valida (${lastQuality.reason}); ` +
              `attendo prima di verificare il DOM.`
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

      // Il DOM viene interrogato solo dopo che l'immagine ha superato il controllo
      // di nitidezza/qualità e la stabilità visiva.
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

    // Se esiste una baseline e nessun frame ha superato il controllo di nitidezza,
    // non salviamo deliberatamente una pagina sfocata. Il chiamante considera
    // l'errore recuperabile e passa a OCR/PDF delle pagine già acquisite.
    if (settings.checkQuality && baselineSharpness != null && !lastAcceptableCapture) {
      throw new Error(
        `Pagina ${pageNumber}: timeout con immagine ancora non valida` +
        `${lastQuality?.reason ? ` (${lastQuality.reason})` : ""}.`
      );
    }

    if (!lastAcceptableCapture && !stopRequested) {
      lastAcceptableCapture = await captureRegionNow();
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
