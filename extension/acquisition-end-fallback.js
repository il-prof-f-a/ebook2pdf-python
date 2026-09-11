(() => {
  const originalStart = document.getElementById("start");
  if (!originalStart) return;

  const startButton = originalStart.cloneNode(true);
  originalStart.replaceWith(startButton);

  const pagesInput = document.getElementById("pages");
  const allPagesInput = document.getElementById("allPages");
  const errorBanner = document.getElementById("acquisitionErrorBanner");
  const errorMessage = document.getElementById("acquisitionErrorMessage");
  const errorContext = document.getElementById("acquisitionErrorContext");
  const retryErrorButton = document.getElementById("retryAcquisitionError");
  const finalizeErrorButton = document.getElementById("finalizeAcquisitionError");

  let pendingErrorDecision = null;
  let pausedStepText = "";

  function syncPageMode() {
    if (!pagesInput || !allPagesInput) return;
    pagesInput.disabled = allPagesInput.checked;
    pagesInput.title = allPagesInput.checked
      ? "Modalità Tutte: il numero di pagine viene determinato automaticamente"
      : "Numero massimo di pagine da acquisire";
  }

  allPagesInput?.addEventListener("change", syncPageMode);
  syncPageMode();

  function isMissingNextControl(result) {
    const message = String(result?.error || "");
    return /pagina successiva/i.test(message) && /non trovato/i.test(message);
  }

  function hideErrorBanner() {
    errorBanner?.classList.add("hidden");
    if (errorMessage) errorMessage.textContent = "";
    if (errorContext) errorContext.textContent = "";
  }

  function resolveErrorDecision(action) {
    if (!pendingErrorDecision) return;
    const resolve = pendingErrorDecision;
    pendingErrorDecision = null;
    hideErrorBanner();
    if (pausedStepText) setStep(pausedStepText);
    pausedStepText = "";
    resolve(action);
  }

  retryErrorButton?.addEventListener("click", () => resolveErrorDecision("retry"));
  finalizeErrorButton?.addEventListener("click", () => resolveErrorDecision("finalize"));

  // Se l'utente usa il pulsante Ferma mentre il banner è aperto, non lasciamo
  // una Promise sospesa: la scelta equivale a chiudere con quanto già acquisito.
  document.getElementById("stop")?.addEventListener("click", () => {
    if (pendingErrorDecision) resolveErrorDecision("finalize");
  }, true);

  function waitForErrorDecision(error, pageNumber, pagesCount) {
    const message = String(error?.message || error || "Errore sconosciuto");
    pausedStepText = document.getElementById("stepText")?.textContent || "";
    setStep("Acquisizione in pausa per errore.");

    if (errorMessage) errorMessage.textContent = message;
    if (errorContext) {
      errorContext.textContent =
        `Pagina in elaborazione: ${pageNumber}. Pagine già salvate in memoria: ${pagesCount}. ` +
        "Puoi ritentare senza perdere quanto acquisito oppure chiudere la scansione e generare il PDF.";
    }
    errorBanner?.classList.remove("hidden");

    log(
      `ERRORE pagina ${pageNumber}: ${message}. Acquisizione in pausa: ` +
      `scegli “Riprova e continua” oppure “Chiudi e genera PDF”.`
    );

    return new Promise(resolve => {
      pendingErrorDecision = resolve;
    });
  }

  async function probeCurrentPageChange(previousImageData, settings, pageNumber) {
    if (!previousImageData) return { changed: true, difference: null };
    const capture = await captureRegionNow();
    const difference = imageDifference(capture.imageData, previousImageData);
    const threshold = settings.pageChangeThresholdPct / 100;
    const changed = difference >= threshold;

    log(
      changed
        ? `Pagina ${pageNumber}: dopo l'errore il cambio risulta già avvenuto (Δ ${(difference * 100).toFixed(3)}%); non ripeto il click avanti.`
        : `Pagina ${pageNumber}: dopo l'errore il cambio non risulta avvenuto (Δ ${(difference * 100).toFixed(3)}%); il click avanti può essere ritentato.`
    );
    return { changed, difference };
  }

  async function acquirePage({
    pageIndex,
    previousImageData,
    settings,
    enableOcr,
    pages,
    state
  }) {
    const pageNumber = pageIndex + 1;

    if (pageIndex === 0) {
      return {
        readiness: await waitForRenderedPage(null, settings, pageNumber),
        endOfDocument: false,
        navigationInterrupted: false
      };
    }

    // Dopo un errore non sappiamo sempre se CLICK_NEXT abbia già avuto effetto.
    // Prima di ritentarlo confrontiamo il frame corrente con la pagina precedente.
    if (state.needsReconcile) {
      const probe = await probeCurrentPageChange(previousImageData, settings, pageNumber);
      state.pageAdvanced = probe.changed;
      state.needsReconcile = false;
    }

    while (state.attempt <= settings.attempts && !stopRequested) {
      if (!state.pageAdvanced) {
        let clicked;
        try {
          clicked = await sendToTab({ type: "CLICK_NEXT", selector: nextTarget.selector });
        } catch (error) {
          if (error?.ebook2pdfActionUncertain || error?.ebook2pdfMessageChannelClosed) {
            state.needsReconcile = true;
          }
          throw error;
        }

        if (!clicked?.ok) {
          if (isMissingNextControl(clicked)) {
            log(
              `Fine documento rilevata dopo ${pages.length} pagine; ` +
              `proseguo con ${enableOcr ? "OCR" : "PDF"}.`
            );
            return { readiness: null, endOfDocument: true, navigationInterrupted: true };
          }
          throw new Error(clicked?.error || "Impossibile avanzare alla pagina successiva");
        }

        state.pageAdvanced = true;
        log(`Pagina ${pageNumber}: cambio pagina, tentativo ${state.attempt}/${settings.attempts}.`);
      }

      let readiness;
      try {
        readiness = await waitForRenderedPage(previousImageData, settings, pageNumber);
      } catch (error) {
        // Alla ripresa controlleremo lo schermo prima di decidere se ricliccare.
        state.needsReconcile = true;
        throw error;
      }

      if (!settings.checkDuplicates || readiness.changed) {
        return { readiness, endOfDocument: false, navigationInterrupted: false };
      }

      log(
        `Pagina ${pageNumber}: contenuto non cambiato abbastanza ` +
        `(Δ ${(Number(readiness.changeDifference || 0) * 100).toFixed(3)}%). Riprovo il comando avanti.`
      );

      state.pageAdvanced = false;
      state.attempt += 1;
      if (state.attempt <= settings.attempts) await sleep(settings.retryDelay * 1000);
    }

    return { readiness: null, endOfDocument: false, navigationInterrupted: true };
  }

  async function finalizeCapturedPages({
    pages,
    settings,
    enableOcr,
    acquireAll,
    reachedEndOfDocument,
    navigationInterrupted,
    acquisitionError,
    closedAfterError
  }) {
    hideErrorBanner();

    if (!pages.length) {
      if (acquisitionError) log(`ERRORE: ${acquisitionError?.message || acquisitionError}`);
      log("Nessuna pagina acquisita: PDF non creato.");
      setStep("Operazione terminata senza pagine.");
      return;
    }

    if (acquireAll) {
      $("progress").max = pages.length;
      $("progress").value = pages.length;
      $("progressText").textContent = reachedEndOfDocument
        ? `${pages.length} pagine acquisite — fine documento`
        : `${pages.length} pagine acquisite`;
    }

    if (acquisitionError && closedAfterError && !stopRequested) {
      log(
        `Acquisizione chiusa su richiesta dopo l'errore: ${acquisitionError?.message || acquisitionError}. ` +
        `Conservo ${pages.length} pagine e procedo con ${enableOcr ? "OCR e PDF" : "il PDF"}.`
      );
    } else if (navigationInterrupted && !reachedEndOfDocument) {
      log(`Acquisizione interrotta dopo ${pages.length} pagine per evitare duplicati o salti di numerazione.`);
    }

    let searchablePdf = false;
    if (enableOcr && !stopRequested) {
      try {
        searchablePdf = await runOcr(pages, settings);
      } catch (ocrError) {
        log(`ERRORE OCR recuperabile: ${ocrError?.message || ocrError}`);
        log("Salvo comunque tutte le pagine acquisite nel PDF senza OCR.");
      }
    } else if (enableOcr && stopRequested) {
      log("OCR saltato perché è stato richiesto l'arresto manuale; salvo comunque le pagine già acquisite.");
    }

    setStep(enableOcr ? "3/3 — Creazione PDF" : "2/2 — Creazione PDF");

    try {
      let downloadedAsSearchable = false;
      if (searchablePdf) {
        try {
          log("Compongo il PDF: immagine originale + layer text-only nativo di Tesseract...");
          downloadedAsSearchable = await downloadPdf(pages, true);
        } catch (pdfError) {
          log(`ERRORE composizione PDF OCR recuperabile: ${pdfError?.message || pdfError}`);
          log("Fallback: creo il PDF normale con tutte le immagini acquisite.");
          await downloadPdf(pages, false);
        }
      } else {
        log(`Creo PDF con ${pages.length} pagine...`);
        await downloadPdf(pages, false);
      }

      log(downloadedAsSearchable
        ? "PDF ricercabile generato e inviato al download."
        : "PDF generato e inviato al download.");
      setStep(closedAfterError ? "Completato con le pagine acquisite prima dell'errore." : "Completato.");
    } catch (saveError) {
      log(`ERRORE salvataggio PDF: ${saveError?.message || saveError}`);
      setStep("Errore durante il salvataggio PDF.");
    }
  }

  startButton.addEventListener("click", async () => {
    if (!region || !nextTarget) {
      log("Seleziona prima area pagina e comando avanti.");
      return;
    }

    hideErrorBanner();
    const acquireAll = allPagesInput?.checked === true;
    const requestedPages = Math.max(1, Number($("pages").value) || 1);
    const settings = settingsFromForm();
    const enableOcr = $("enableOcr").checked;

    stopRequested = false;
    $("start").disabled = true;
    $("stop").disabled = false;
    $("log").textContent = "";
    $("ocrProgressBox").classList.add("hidden");
    setStep(enableOcr ? "1/3 — Acquisizione" : "1/2 — Acquisizione");

    if (acquireAll) {
      $("progress").max = 1;
      $("progress").removeAttribute("value");
      $("progressText").textContent = "0 pagine acquisite — modalità Tutte";
      log("Modalità Tutte: continuo fino a quando il comando “pagina successiva” non è più disponibile.");
    } else {
      $("progress").max = requestedPages;
      $("progress").value = 0;
      $("progressText").textContent = `0/${requestedPages}`;
    }

    log(
      `Rendering: max ${settings.renderMaxWait.toFixed(1)}s, intervallo ${settings.stabilityInterval.toFixed(1)}s, ` +
      `${Math.max(3, settings.stableSamples)} conferme di convergenza, soglia pixel ${settings.stabilityThresholdPct.toFixed(2)}%, ` +
      `DOM/overlay ${settings.useDomSignals ? "attivi" : "disattivati"}.`
    );

    const pages = [];
    let previousImageData = null;
    let navigationInterrupted = false;
    let reachedEndOfDocument = false;
    let acquisitionError = null;
    let closedAfterError = false;

    acquisitionLoop:
    for (let pageIndex = 0; !stopRequested && (acquireAll || pageIndex < requestedPages); pageIndex++) {
      const pageNumber = pageIndex + 1;
      const state = {
        attempt: 1,
        pageAdvanced: pageIndex === 0,
        needsReconcile: false
      };

      while (!stopRequested) {
        let result;
        try {
          result = await acquirePage({
            pageIndex,
            previousImageData,
            settings,
            enableOcr,
            pages,
            state
          });
        } catch (error) {
          if (error?.ebook2pdfStop || stopRequested) {
            log("Acquisizione fermata dall'utente: preparo il PDF con quanto già acquisito.");
            break acquisitionLoop;
          }

          const decision = await waitForErrorDecision(error, pageNumber, pages.length);
          if (decision === "finalize") {
            acquisitionError = error;
            closedAfterError = true;
            break acquisitionLoop;
          }

          log(`Pagina ${pageNumber}: nuovo tentativo richiesto dall'utente; riprendo senza perdere le ${pages.length} pagine già acquisite.`);
          if (pageIndex > 0) state.needsReconcile = true;
          continue;
        }

        if (result.endOfDocument) {
          reachedEndOfDocument = true;
          navigationInterrupted = true;
          break acquisitionLoop;
        }

        if (result.navigationInterrupted && !result.readiness) {
          navigationInterrupted = true;
          log(`Pagina ${pageNumber}: cambio non rilevato dopo ${settings.attempts} tentativi. Interrompo l'acquisizione.`);
          break acquisitionLoop;
        }

        const readiness = result.readiness;
        if (stopRequested) break acquisitionLoop;
        if (!readiness?.capture) {
          const error = new Error(`Impossibile acquisire la pagina ${pageNumber}`);
          const decision = await waitForErrorDecision(error, pageNumber, pages.length);
          if (decision === "finalize") {
            acquisitionError = error;
            closedAfterError = true;
            break acquisitionLoop;
          }
          if (pageIndex > 0) state.needsReconcile = true;
          continue;
        }

        if (readiness.timedOut) {
          log(
            `Pagina ${pageNumber}: timeout rendering; uso il miglior frame convergente disponibile` +
            `${readiness.reason ? ` (${readiness.reason})` : ""}.`
          );
        }

        const capture = readiness.capture;
        pages.push({ width: capture.width, height: capture.height, jpeg: capture.jpeg });
        previousImageData = capture.imageData;

        if (acquireAll) {
          log(`Pagina ${pageNumber} acquisita.`);
          $("progress").removeAttribute("value");
          $("progressText").textContent = `${pages.length} pagine acquisite — modalità Tutte`;
        } else {
          log(`Pagina ${pageNumber}/${requestedPages} acquisita.`);
          $("progress").value = pageNumber;
          $("progressText").textContent = `${pageNumber}/${requestedPages} — salvate ${pages.length}`;
        }
        break;
      }
    }

    try {
      await finalizeCapturedPages({
        pages,
        settings,
        enableOcr,
        acquireAll,
        reachedEndOfDocument,
        navigationInterrupted,
        acquisitionError,
        closedAfterError
      });
    } finally {
      hideErrorBanner();
      pendingErrorDecision = null;
      $("start").disabled = false;
      $("stop").disabled = true;
    }
  });
})();