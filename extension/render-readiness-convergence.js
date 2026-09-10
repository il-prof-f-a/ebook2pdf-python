(() => {
  const EDGE_DELTA_LIMIT = 0.12;
  const CONTRAST_DELTA_LIMIT = 0.08;
  const ENTROPY_DELTA_LIMIT = 0.06;
  const MIN_CONSECUTIVE_SAMPLES = 3;

  function relativeDelta(a, b, floor = 1) {
    const av = Number(a) || 0;
    const bv = Number(b) || 0;
    return Math.abs(av - bv) / Math.max(floor, Math.abs(av), Math.abs(bv));
  }

  function visualProfile(imageData) {
    const { data, width, height } = imageData;
    const histogram = new Array(16).fill(0);
    const step = 4;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    let edgeSum = 0;
    let edgeCount = 0;
    let centerEdgeSum = 0;
    let centerEdgeCount = 0;
    let outerEdgeSum = 0;
    let outerEdgeCount = 0;

    const cx0 = width * 0.35;
    const cx1 = width * 0.65;
    const cy0 = height * 0.35;
    const cy1 = height * 0.65;

    const grayAt = (x, y) => {
      const i = (y * width + x) * 4;
      return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    };

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const gray = grayAt(x, y);
        sum += gray;
        sumSq += gray * gray;
        histogram[Math.min(15, Math.floor(gray / 16))]++;
        count++;

        let localEdge = 0;
        let localCount = 0;
        if (x + step < width) {
          localEdge += Math.abs(gray - grayAt(x + step, y));
          localCount++;
        }
        if (y + step < height) {
          localEdge += Math.abs(gray - grayAt(x, y + step));
          localCount++;
        }
        if (!localCount) continue;

        edgeSum += localEdge;
        edgeCount += localCount;
        const inCenter = x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
        if (inCenter) {
          centerEdgeSum += localEdge;
          centerEdgeCount += localCount;
        } else {
          outerEdgeSum += localEdge;
          outerEdgeCount += localCount;
        }
      }
    }

    const mean = count ? sum / count : 0;
    const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
    const contrast = Math.sqrt(variance);
    const edgeEnergy = edgeCount ? edgeSum / edgeCount : 0;
    const centerEdge = centerEdgeCount ? centerEdgeSum / centerEdgeCount : 0;
    const outerEdge = outerEdgeCount ? outerEdgeSum / outerEdgeCount : 0;
    const dominantRatio = count ? Math.max(...histogram) / count : 1;

    let entropy = 0;
    if (count) {
      for (const value of histogram) {
        if (!value) continue;
        const p = value / count;
        entropy -= p * Math.log2(p);
      }
    }

    return { mean, contrast, edgeEnergy, centerEdge, outerEdge, dominantRatio, entropy };
  }

  function profileConverged(previous, current) {
    if (!previous || !current) return false;
    return (
      relativeDelta(previous.edgeEnergy, current.edgeEnergy, 2) <= EDGE_DELTA_LIMIT &&
      relativeDelta(previous.contrast, current.contrast, 8) <= CONTRAST_DELTA_LIMIT &&
      relativeDelta(previous.entropy, current.entropy, 0.5) <= ENTROPY_DELTA_LIMIT
    );
  }

  function likelyLoadingPlaceholder(profile) {
    if (!profile) return false;
    const grayField =
      profile.mean >= 150 &&
      profile.mean <= 242 &&
      profile.contrast < 18 &&
      profile.dominantRatio >= 0.82;
    const centeredIndicator =
      profile.outerEdge < 1.8 &&
      profile.centerEdge >= Math.max(2.5, profile.outerEdge * 2.4);
    return grayField && centeredIndicator;
  }

  function profileScore(profile) {
    if (!profile) return -Infinity;
    return profile.edgeEnergy + profile.contrast * 0.12 + profile.entropy * 2;
  }

  function explicitDomBlocker(state) {
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

  const baseDomStateSummary = domStateSummary;
  domStateSummary = function convergenceDomStateSummary(state) {
    if (!state) return "segnali DOM non disponibili";
    const parts = [];
    if (!state.documentReady) parts.push("documento non completo");
    if (!state.fontsReady) parts.push("font in caricamento");
    if (state.busyCount) parts.push(`${state.busyCount} loader/busy`);
    if (state.incompleteImageCount) parts.push(`${state.incompleteImageCount} immagini incomplete`);
    if (state.overlayCount) parts.push(`${state.overlayCount} overlay sospetti`);
    if (state.animatedBusyCount) parts.push(`${state.animatedBusyCount} indicatori animati`);
    if (state.filteredCount) parts.push(`${state.filteredCount} elementi con filtro di offuscamento`);
    if (state.waitCursorCount) parts.push(`${state.waitCursorCount} cursori di attesa`);
    if (!state.domIdle) parts.push(`DOM modificato ${state.mutationIdleMs} ms fa`);
    if (!parts.length) return "DOM pronto, nessun blocker";
    return parts.join(", ");
  };

  readDomRenderState = async function readEnhancedDomRenderState(settings) {
    if (!settings.useDomSignals) return null;
    try {
      const state = await sendToTab({
        type: "GET_RENDER_STATE_V2",
        region,
        mutationIdleMs: settings.domIdleMs
      });
      if (state?.ok) return state;
    } catch (_) {}

    try {
      const fallback = await sendToTab({
        type: "GET_RENDER_STATE",
        region,
        mutationIdleMs: settings.domIdleMs
      });
      return fallback?.ok ? fallback : null;
    } catch (error) {
      console.warn("Ebook2PDF: segnali DOM non disponibili", error);
      return null;
    }
  };

  waitForRenderedPage = async function waitForConvergedPage(previousImageData, settings, pageNumber) {
    const requireChange = !!previousImageData && settings.checkDuplicates;
    const changeThreshold = settings.pageChangeThresholdPct / 100;
    const stableThreshold = settings.stabilityThresholdPct / 100;
    const intervalMs = settings.stabilityInterval * 1000;
    const requiredSamples = Math.max(MIN_CONSECUTIVE_SAMPLES, Number(settings.stableSamples) || 0);
    const deadline = performance.now() + settings.renderMaxWait * 1000;

    let changed = !requireChange;
    let previousFrame = null;
    let previousProfile = null;
    let lastCapture = null;
    let lastProfile = null;
    let lastDomState = null;
    let stableComparisons = 0;
    let changeDifference = null;
    let frameDifference = null;
    let bestCapture = null;
    let bestScore = -Infinity;
    let bestReadyCapture = null;
    let placeholderLogged = false;
    let domUnavailableLogged = false;

    await sleep(settings.delay * 1000);

    while (!stopRequested && performance.now() < deadline) {
      const capture = await captureRegionNow();
      const profile = visualProfile(capture.imageData);
      const placeholder = likelyLoadingPlaceholder(profile);
      lastCapture = capture;
      lastProfile = profile;

      if (requireChange && !changed) {
        changeDifference = imageDifference(capture.imageData, previousImageData);
        if (changeDifference < changeThreshold) {
          await sleep(intervalMs);
          continue;
        }
        changed = true;
        previousFrame = null;
        previousProfile = null;
        stableComparisons = 0;
        log(`Pagina ${pageNumber}: cambio rilevato (${(changeDifference * 100).toFixed(3)}%).`);
      }

      if (!placeholder) {
        const score = profileScore(profile);
        if (score > bestScore) {
          bestScore = score;
          bestCapture = capture;
        }
      }

      if (placeholder) {
        if (!placeholderLogged) {
          log(`Pagina ${pageNumber}: rilevato possibile placeholder/indicatore centrale di caricamento; continuo ad attendere.`);
          placeholderLogged = true;
        }
        previousFrame = capture;
        previousProfile = profile;
        stableComparisons = 0;
        await sleep(intervalMs);
        continue;
      }
      if (placeholderLogged) {
        log(`Pagina ${pageNumber}: placeholder non più rilevato; verifico la convergenza del contenuto.`);
        placeholderLogged = false;
      }

      if (previousFrame && previousProfile) {
        frameDifference = imageDifference(capture.imageData, previousFrame.imageData);
        const pixelsStable = frameDifference <= stableThreshold;
        const metricsStable = profileConverged(previousProfile, profile);
        stableComparisons = pixelsStable && metricsStable ? stableComparisons + 1 : 0;
      }

      previousFrame = capture;
      previousProfile = profile;

      if (stableComparisons < requiredSamples) {
        await sleep(intervalMs);
        continue;
      }

      lastDomState = await readDomRenderState(settings);
      if (settings.useDomSignals && !lastDomState && !domUnavailableLogged) {
        log(`Pagina ${pageNumber}: segnali DOM avanzati non disponibili; uso la convergenza visiva.`);
        domUnavailableLogged = true;
      }

      if (!lastDomState || (!explicitDomBlocker(lastDomState) && lastDomState.ready)) {
        bestReadyCapture = capture;
        log(
          `Pagina ${pageNumber}: contenuto convergente per ${stableComparisons} controlli ` +
          `(Δ pixel ${(Number(frameDifference || 0) * 100).toFixed(3)}%, ` +
          `bordi ${profile.edgeEnergy.toFixed(2)}, contrasto ${profile.contrast.toFixed(2)}, ` +
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
          profile
        };
      }

      if (!explicitDomBlocker(lastDomState) && stableComparisons >= requiredSamples) {
        bestReadyCapture = capture;
      }

      await sleep(intervalMs);
    }

    if (stopRequested) {
      return {
        capture: bestReadyCapture || bestCapture || lastCapture,
        changed,
        timedOut: true,
        stableComparisons,
        frameDifference,
        changeDifference,
        domState: lastDomState,
        profile: lastProfile,
        reason: "arresto richiesto"
      };
    }

    if (bestReadyCapture) {
      return {
        capture: bestReadyCapture,
        changed,
        timedOut: true,
        stableComparisons,
        frameDifference,
        changeDifference,
        domState: lastDomState,
        profile: lastProfile,
        reason: "timeout DOM dopo convergenza visiva"
      };
    }

    const detail = lastDomState ? domStateSummary(lastDomState) : "nessun frame ha raggiunto una convergenza affidabile";
    throw new Error(`Pagina ${pageNumber}: timeout di caricamento (${detail}).`);
  };

  globalThis.Ebook2PdfRenderConvergence = {
    visualProfile,
    profileConverged,
    likelyLoadingPlaceholder
  };
})();
