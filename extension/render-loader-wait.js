(() => {
  const baseWaitForRenderedPage = waitForRenderedPage;

  function hasExplicitLoadingBlocker(state) {
    if (!state) return false;
    return Boolean(
      state.busyCount ||
      state.incompleteImageCount ||
      state.overlayCount ||
      state.animatedBusyCount ||
      state.filteredCount ||
      state.waitCursorCount
    );
  }

  function timeoutAlreadyReportedLoading(error) {
    const message = String(error?.message || error || "");
    return /loader\/busy|immagini incomplete|overlay sospett|indicatori animati|filtro di offuscamento|cursori di attesa|placeholder/i.test(message);
  }

  async function inspectCurrentLoadingState(settings) {
    let domState = null;
    let placeholder = false;

    try {
      domState = await readDomRenderState(settings);
    } catch (_) {}

    try {
      const api = globalThis.Ebook2PdfRenderConvergence;
      if (api?.visualProfile && api?.likelyLoadingPlaceholder) {
        const capture = await captureRegionNow();
        const profile = api.visualProfile(capture.imageData);
        placeholder = api.likelyLoadingPlaceholder(profile);
      }
    } catch (_) {}

    return {
      domState,
      placeholder,
      loading: placeholder || hasExplicitLoadingBlocker(domState)
    };
  }

  waitForRenderedPage = async function waitForRenderedPageKeepingLoaders(
    previousImageData,
    settings,
    pageNumber
  ) {
    let renewedTimeouts = 0;

    while (!stopRequested) {
      try {
        return await baseWaitForRenderedPage(previousImageData, settings, pageNumber);
      } catch (error) {
        const message = String(error?.message || error || "");
        if (!/timeout di caricamento/i.test(message)) throw error;

        const state = await inspectCurrentLoadingState(settings);
        const loadingWasExplicit = timeoutAlreadyReportedLoading(error);

        if (!state.loading && !loadingWasExplicit) {
          throw error;
        }

        renewedTimeouts++;
        const detail = state.placeholder
          ? "placeholder/indicatore centrale di caricamento"
          : state.domState
            ? domStateSummary(state.domState)
            : "indicatore di caricamento rilevato al timeout precedente";

        log(
          `Pagina ${pageNumber}: il tempo massimo ordinario è scaduto, ma la pagina sta ancora caricando ` +
          `(${detail}). Continuo ad attendere la stessa pagina senza interrompere la scansione ` +
          `(attesa estesa ${renewedTimeouts}).`
        );

        const pauseMs = Math.max(250, Math.min(1000, Number(settings.stabilityInterval || 0.4) * 1000));
        await sleep(pauseMs);
      }
    }

    return baseWaitForRenderedPage(previousImageData, settings, pageNumber);
  };
})();
