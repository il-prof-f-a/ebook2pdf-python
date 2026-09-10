(() => {
  if (globalThis.__ebook2pdfReadinessV2) return;
  globalThis.__ebook2pdfReadinessV2 = true;

  let observedRegion = null;
  let lastRelevantMutationAt = performance.now();

  const LOADING_RE = /(loading|loader|spinner|progress|busy|wait|pending|skeleton|placeholder|preload)/i;

  function normalizeRegion(region) {
    if (!region) return null;
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  }

  function intersectionArea(rect, region) {
    if (!rect || !region) return 0;
    const left = Math.max(rect.left, region.x);
    const top = Math.max(rect.top, region.y);
    const right = Math.min(rect.right, region.x + region.width);
    const bottom = Math.min(rect.bottom, region.y + region.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function intersectsRegion(rect, region) {
    return intersectionArea(rect, region) > 0;
  }

  function visibleElement(el, region) {
    if (!(el instanceof Element)) return false;
    let style;
    try {
      style = getComputedStyle(el);
    } catch (_) {
      return false;
    }
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && intersectsRegion(rect, region);
  }

  function descriptiveText(el) {
    return [
      el.id,
      el.className,
      el.getAttribute?.("role"),
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.getAttribute?.("data-state"),
      el.getAttribute?.("data-loading")
    ].filter(Boolean).join(" ");
  }

  function animationActive(style) {
    const name = String(style.animationName || "");
    const duration = String(style.animationDuration || "");
    return name && name !== "none" && duration && !/^0(?:s|ms)(?:,|$)/.test(duration);
  }

  function hasVisualFilter(style) {
    const filter = `${style.filter || ""} ${style.backdropFilter || ""} ${style.webkitBackdropFilter || ""}`;
    return /blur\s*\(/i.test(filter);
  }

  function overlayLike(el, style, region) {
    const rect = el.getBoundingClientRect();
    const regionArea = Math.max(1, region.width * region.height);
    const covered = intersectionArea(rect, region) / regionArea;
    const position = String(style.position || "");
    const z = Number.parseInt(style.zIndex, 10);
    const elevated = Number.isFinite(z) && z >= 10;
    const semantic = LOADING_RE.test(descriptiveText(el));
    const waitCursor = /^(wait|progress)$/.test(String(style.cursor || ""));
    const filtered = hasVisualFilter(style);

    if (semantic || waitCursor || filtered) return true;
    return covered >= 0.25 && ["fixed", "absolute", "sticky"].includes(position) && elevated;
  }

  function selectorBusyElements(region) {
    const selectors = [
      '[aria-busy="true"]',
      '[data-loading="true"]',
      '[role="progressbar"]',
      '[class*="spinner" i]',
      '[class*="loader" i]',
      '[class*="loading" i]',
      '[class*="skeleton" i]',
      '[id*="spinner" i]',
      '[id*="loader" i]',
      '[id*="loading" i]',
      '[id*="progress" i]'
    ];
    const found = new Set();
    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (visibleElement(el, region)) found.add(el);
        }
      } catch (_) {}
    }
    return found;
  }

  function sampledBlockers(region) {
    const overlays = new Set();
    const animated = new Set();
    const filtered = new Set();
    const waitCursor = new Set();

    const fractions = [0.15, 0.5, 0.85];
    for (const fy of fractions) {
      for (const fx of fractions) {
        const x = Math.min(innerWidth - 1, Math.max(0, region.x + region.width * fx));
        const y = Math.min(innerHeight - 1, Math.max(0, region.y + region.height * fy));
        let stack = [];
        try {
          stack = document.elementsFromPoint(x, y) || [];
        } catch (_) {}

        for (const el of stack.slice(0, 10)) {
          if (!(el instanceof Element) || !visibleElement(el, region)) continue;
          let style;
          try {
            style = getComputedStyle(el);
          } catch (_) {
            continue;
          }
          if (overlayLike(el, style, region)) overlays.add(el);
          if (animationActive(style) && LOADING_RE.test(descriptiveText(el))) animated.add(el);
          if (hasVisualFilter(style)) filtered.add(el);
          if (/^(wait|progress)$/.test(String(style.cursor || ""))) waitCursor.add(el);
        }
      }
    }

    return {
      overlayCount: overlays.size,
      animatedBusyCount: animated.size,
      filteredCount: filtered.size,
      waitCursorCount: waitCursor.size
    };
  }

  function incompleteImages(region) {
    let count = 0;
    for (const img of document.images || []) {
      if (!visibleElement(img, region)) continue;
      if (!img.complete || img.naturalWidth === 0) count++;
    }
    return count;
  }

  const observer = new MutationObserver(records => {
    if (!observedRegion) {
      lastRelevantMutationAt = performance.now();
      return;
    }
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      if (!target) {
        lastRelevantMutationAt = performance.now();
        return;
      }
      try {
        if (intersectsRegion(target.getBoundingClientRect(), observedRegion)) {
          lastRelevantMutationAt = performance.now();
          return;
        }
      } catch (_) {}
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
  }

  function getRenderState(region, requestedIdleMs = 500) {
    const normalized = normalizeRegion(region) || {
      x: 0,
      y: 0,
      width: Math.max(1, innerWidth),
      height: Math.max(1, innerHeight)
    };
    observedRegion = normalized;

    const busyCount = selectorBusyElements(normalized).size;
    const blockers = sampledBlockers(normalized);
    const incompleteImageCount = incompleteImages(normalized);
    const mutationIdleMs = Math.max(0, performance.now() - lastRelevantMutationAt);
    const documentReady = document.readyState === "complete";
    const fontsReady = !document.fonts || document.fonts.status === "loaded";
    const domIdle = mutationIdleMs >= Math.max(0, Number(requestedIdleMs) || 0);

    const ready =
      documentReady &&
      fontsReady &&
      domIdle &&
      busyCount === 0 &&
      incompleteImageCount === 0 &&
      blockers.overlayCount === 0 &&
      blockers.animatedBusyCount === 0 &&
      blockers.filteredCount === 0 &&
      blockers.waitCursorCount === 0;

    return {
      ok: true,
      ready,
      documentReady,
      fontsReady,
      domIdle,
      mutationIdleMs: Math.round(mutationIdleMs),
      busyCount,
      incompleteImageCount,
      ...blockers
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING_READINESS") {
      sendResponse({ ok: true, version: 2 });
      return;
    }
    if (message?.type === "GET_RENDER_STATE_V2") {
      sendResponse(getRenderState(message.region, message.mutationIdleMs));
    }
  });
})();
