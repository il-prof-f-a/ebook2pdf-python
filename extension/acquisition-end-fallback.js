(() => {
  const originalStart = document.getElementById("start");
  if (!originalStart) return;

  // Rimuove il listener di acquisizione registrato in sidepanel.js senza
  // toccare il resto dell'interfaccia, quindi installa la variante che
  // considera la scomparsa del comando "pagina successiva" come fine
  // naturale dell'acquisizione e prosegue con OCR/PDF.
  const startButton = originalStart.cloneNode(true);
  originalStart.replaceWith(startButton);

  const pagesInput = document.getElementById("pages");
  const allPagesInput = document.getElementById("allPages");

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

  startButton.addEventListener("click", async () => {
    if (!region || !nextTarget) {
      log("Seleziona prima area pagina e comando avanti.");
      return;
    }

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
      `${settings.stableSamples} conferme, soglia stabilità ${settings.stabilityThresholdPct.toFixed(2)}%, ` +
      `DOM ${settings.useDomSignals ? "attivo" : "disattivo"}.`
    );
    if (settings.checkQuality) {
      log(`Nitidezza diagnostica: ratio ${settings.sharpnessRatio.toFixed(2)} (non causa più lo scarto della pagina).`);
    }

    const pages = [];
    let previousImageData = null;
    let baselineSharpness = null;
    let searchablePdf = false;
    let navigationInterrupted = false;
    let reachedEndOfDocument = false;

    try {
      for (
        let pageIndex = 0;
        !stopRequested && (acquireAll || pageIndex < requestedPages);
        pageIndex++
      ) {
        const pageNumber = pageIndex + 1;
        let readiness = null;

        if (pageIndex === 0) {
          readiness = await waitForRenderedPage(null, settings, pageNumber);
        } else {
          let changed = false;

          for (let attempt = 1; attempt <= settings.attempts && !stopRequested; attempt++) {
            const clicked = await sendToTab({ type: "CLICK_NEXT", selector: nextTarget.selector });

            if (!clicked?.ok) {
              if (isMissingNextControl(clicked)) {
                reachedEndOfDocument = true;
                navigationInterrupted = true;
                log(
                  `Comando “pagina successiva” non più disponibile. ` +
                  `Fine documento rilevata dopo ${pages.length} pagine; proseguo con ${enableOcr ? "l'OCR" : "la creazione del PDF"}.`
                );
                break;
              }
              throw new Error(clicked?.error || "Impossibile avanzare alla pagina successiva");
            }

            log(`Pagina ${pageNumber}: cambio pagina, tentativo ${attempt}/${settings.attempts}.`);
            readiness = await waitForRenderedPage(previousImageData, settings, pageNumber);

            if (!settings.checkDuplicates || readiness.changed) {
              changed = true;
              break;
            }

            log(
              `Pagina ${pageNumber}: il contenuto non è cambiato abbastanza ` +
              `(Δ ${(Number(readiness.changeDifference || 0) * 100).toFixed(3)}%). Riprovo il comando avanti.`
            );
            if (attempt < settings.attempts) await sleep(settings.retryDelay * 1000);
          }

          if (reachedEndOfDocument) break;

          if (!changed && settings.checkDuplicates && !stopRequested) {
            navigationInterrupted = true;
            log(
              `Pagina ${pageNumber}: cambio pagina non rilevato dopo ${settings.attempts} tentativi. ` +
              `Interrompo l'acquisizione come protezione contro duplicati o viewer bloccato.`
            );
            break;
          }
        }

        if (stopRequested) break;
        if (!readiness?.capture) throw new Error(`Impossibile acquisire la pagina ${pageNumber}`);

        if (readiness.timedOut) {
          log(
            `Pagina ${pageNumber}: timeout attesa rendering; acquisisco comunque l'ultimo frame stabile disponibile ` +
            `(${domStateSummary(readiness.domState)}).`
          );
        }

        const capture = readiness.capture;

        if (settings.checkQuality) {
          const validation = validateImage(capture.imageData, baselineSharpness, settings.sharpnessRatio);
          if (baselineSharpness == null && validation.sharpness != null) {
            baselineSharpness = validation.sharpness;
            log(`Baseline nitidezza impostata a ${baselineSharpness.toFixed(2)}.`);
          }
          if (!validation.ok) {
            log(`Pagina ${pageNumber}: AVVISO qualità — ${validation.reason}. La pagina viene comunque acquisita.`);
          }
        }

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
      }

      if (!pages.length) {
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

      if (navigationInterrupted && !reachedEndOfDocument) {
        log(`Acquisizione interrotta dopo ${pages.length} pagine per evitare duplicati o salti di numerazione.`);
      }

      if (enableOcr && !stopRequested) {
        try {
          searchablePdf = await runOcr(pages, settings);
        } catch (ocrError) {
          searchablePdf = false;
          log(`ERRORE OCR: ${ocrError?.message || ocrError}`);
          log("Creo comunque il PDF acquisito, senza OCR.");
        }
      } else if (enableOcr && stopRequested) {
        log("OCR saltato perché è stato richiesto l'arresto durante l'acquisizione.");
      }

      setStep(enableOcr ? "3/3 — Creazione PDF" : "2/2 — Creazione PDF");

      let downloadedAsSearchable = false;
      if (searchablePdf) {
        try {
          log("Compongo il PDF: immagine originale + layer text-only nativo di Tesseract...");
          downloadedAsSearchable = await downloadPdf(pages, true);
        } catch (pdfError) {
          log(`ERRORE composizione PDF OCR: ${pdfError?.message || pdfError}`);
          log("Fallback: creo il PDF normale con le immagini acquisite.");
          await downloadPdf(pages, false);
        }
      } else {
        log(`Creo PDF con ${pages.length} pagine...`);
        await downloadPdf(pages, false);
      }

      log(downloadedAsSearchable
        ? "PDF ricercabile con layer Tesseract nativo generato e inviato al download."
        : "PDF generato e inviato al download.");
      setStep("Completato.");
    } catch (error) {
      log(`ERRORE: ${error?.message || error}`);
      setStep("Errore.");
    } finally {
      $("start").disabled = false;
      $("stop").disabled = true;
    }
  });
})();