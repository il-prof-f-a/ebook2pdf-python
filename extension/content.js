(() => {
  let overlay = null;
  let captureRegion = null;
  let lastRelevantMutationAt = performance.now();

  const CLICKABLE_SELECTOR = [
    "button",
    "a[href]",
    "input[type='button']",
    "input[type='submit']",
    "input[type='image']",
    "[role='button']",
    "[role='link']",
    "[onclick]",
    "summary"
  ].join(",");

  function cleanup() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function makeOverlay() {
    cleanup();
    overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(0,0,0,.28)",
      cursor: "crosshair"
    });
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function selectorFor(el) {
    if (!el || el === document.documentElement) return "html";
    if (el.id) return `#${cssEscape(el.id)}`;

    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.classList?.length) {
        part += "." + [...current.classList].slice(0, 2).map(cssEscape).join(".");
      }
      const parent = current.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter(x => x.tagName === current.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
      current = parent;
    }
    return parts.join(" > ");
  }

  function isLikelyClickable(el) {
    if (!(el instanceof Element)) return false;
    try {
      if (el.matches(CLICKABLE_SELECTOR)) return true;
    } catch (_) {}
    if (typeof el.click === "function") {
      const tag = String(el.tagName || "").toLowerCase();
      if (["button", "a", "input", "summary", "label"].includes(tag)) return true;
    }
    try {
      if (getComputedStyle(el).cursor === "pointer") return true;
    } catch (_) {}
    return false;
  }

  function findClickableTarget(el) {
    if (!(el instanceof Element)) return null;

    try {
      const semantic = el.closest(CLICKABLE_SELECTOR);
      if (semantic) return semantic;
    } catch (_) {}

    let current = el;
    for (let depth = 0; current && depth < 8; depth++) {
      if (isLikelyClickable(current)) return current;
      current = current.parentElement;
    }

    return el;
  }

  function targetText(el) {
    if (!(el instanceof Element)) return "";
    return String(
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("title") ||
      el.textContent ||
      ""
    ).trim().replace(/\s+/g, " ").slice(0, 80);
  }

  function dispatchSyntheticClick(el) {
    if (!(el instanceof Element)) throw new Error("Elemento da cliccare non valido");

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(0, rect.width / 2);
    const clientY = rect.top + Math.max(0, rect.height / 2);
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent("mousedown", common));

    if (typeof PointerEvent === "function") {
      el.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    }
    el.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
  }

  function clickElement(el) {
    const target = findClickableTarget(el);
    if (!target) throw new Error("Elemento 'pagina successiva' non trovato");

    if (typeof target.click === "function") {
      target.click();
      return { method: "native", target };
    }

    dispatchSyntheticClick(target);
    return { method: "events", target };
  }

  function normalizeRegion(region) {
    if (!region) return null;
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  }

  function intersectsRegion(rect, region = captureRegion) {
    if (!region) return true;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return !(
      rect.right <= region.x ||
      rect.left >= region.x + region.width ||
      rect.bottom <= region.y ||
      rect.top >= region.y + region.height
    );
  }

  function isVisibleElement(el, region = captureRegion) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    return intersectsRegion(el.getBoundingClientRect(), region);
  }

  function markMutationIfRelevant(target) {
    if (!(target instanceof Element)) {
      lastRelevantMutationAt = performance.now();
      return;
    }
    if (overlay && (target === overlay || overlay.contains(target))) return;
    if (!captureRegion || intersectsRegion(target.getBoundingClientRect(), captureRegion)) {
      lastRelevantMutationAt = performance.now();
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      markMutationIfRelevant(record.target);
      if (performance.now() === lastRelevantMutationAt) break;
    }
  });

  function startMutationObserver() {
    const target = document.documentElement;
    if (!target) return;
    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
  }

  startMutationObserver();

  function selectRegion() {
    return new Promise(resolve => {
      const layer = makeOverlay();
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        border: "2px solid #fff",
        background: "rgba(255,255,255,.08)",
        pointerEvents: "none"
      });
      layer.appendChild(box);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const move = e => {
        if (!dragging) return;
        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        Object.assign(box.style, {
          left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`
        });
      };

      const up = e => {
        if (!dragging) return;
        dragging = false;
        const rect = {
          x: Math.min(startX, e.clientX),
          y: Math.min(startY, e.clientY),
          width: Math.abs(e.clientX - startX),
          height: Math.abs(e.clientY - startY),
          dpr: window.devicePixelRatio || 1
        };
        cleanup();
        captureRegion = rect.width >= 10 && rect.height >= 10 ? normalizeRegion(rect) : null;
        lastRelevantMutationAt = performance.now();
        resolve(captureRegion ? { ...rect } : null);
      };

      layer.addEventListener("mousedown", e => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        dragging = true;
      });
      layer.addEventListener("mousemove", move);
      layer.addEventListener("mouseup", up);
    });
  }

  function selectNextElement() {
    return new Promise(resolve => {
      const layer = makeOverlay();
      const hint = document.createElement("div");
      hint.textContent = "Clicca il comando per andare alla pagina successiva";
      Object.assign(hint.style, {
        position: "fixed",
        left: "50%",
        top: "20px",
        transform: "translateX(-50%)",
        padding: "8px 12px",
        background: "#111",
        color: "#fff",
        borderRadius: "6px",
        font: "14px sans-serif",
        pointerEvents: "none"
      });
      layer.appendChild(hint);

      layer.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const x = e.clientX;
        const y = e.clientY;
        cleanup();
        const rawElement = document.elementFromPoint(x, y);
        const target = findClickableTarget(rawElement);
        resolve(target ? {
          selector: selectorFor(target),
          text: targetText(target),
          selectedTag: String(rawElement?.tagName || "").toLowerCase(),
          targetTag: String(target.tagName || "").toLowerCase()
        } : null);
      }, { once: true });
    });
  }

  function visibleBusyElements(region) {
    const selectors = [
      '[aria-busy="true"]',
      '[data-loading="true"]',
      '[class*="spinner" i]',
      '[class*="loader" i]',
      '[class*="loading" i]',
      '[id*="spinner" i]',
      '[id*="loader" i]',
      '[id*="loading" i]'
    ];
    const found = new Set();
    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) {
          if (isVisibleElement(el, region)) found.add(el);
        }
      } catch (_) {}
    }
    return found.size;
  }

  function incompleteImages(region) {
    let count = 0;
    for (const img of document.images || []) {
      if (!isVisibleElement(img, region)) continue;
      if (!img.complete || img.naturalWidth === 0) count++;
    }
    return count;
  }

  function getRenderState(region, requestedIdleMs = 500) {
    const normalizedRegion = normalizeRegion(region) || captureRegion;
    if (normalizedRegion) captureRegion = normalizedRegion;

    const busyCount = visibleBusyElements(normalizedRegion);
    const incompleteImageCount = incompleteImages(normalizedRegion);
    const mutationIdleMs = Math.max(0, performance.now() - lastRelevantMutationAt);
    const documentReady = document.readyState === "complete";
    const fontsReady = !document.fonts || document.fonts.status === "loaded";
    const domIdle = mutationIdleMs >= Math.max(0, Number(requestedIdleMs) || 0);

    return {
      ok: true,
      ready: documentReady && fontsReady && busyCount === 0 && incompleteImageCount === 0 && domIdle,
      documentReady,
      fontsReady,
      busyCount,
      incompleteImageCount,
      mutationIdleMs: Math.round(mutationIdleMs),
      domIdle
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "SELECT_REGION") {
      selectRegion().then(region => sendResponse({ ok: !!region, region }));
      return true;
    }
    if (message?.type === "SELECT_NEXT") {
      selectNextElement().then(target => sendResponse({ ok: !!target, target }));
      return true;
    }
    if (message?.type === "CLICK_NEXT") {
      try {
        const el = document.querySelector(message.selector);
        if (!el) throw new Error("Elemento 'pagina successiva' non trovato");
        lastRelevantMutationAt = performance.now();
        const result = clickElement(el);
        sendResponse({
          ok: true,
          method: result.method,
          targetTag: String(result.target?.tagName || "").toLowerCase()
        });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
      return;
    }
    if (message?.type === "GET_RENDER_STATE") {
      sendResponse(getRenderState(message.region, message.mutationIdleMs));
      return;
    }
    if (message?.type === "GET_VIEWPORT") {
      sendResponse({ ok: true, dpr: window.devicePixelRatio || 1, width: innerWidth, height: innerHeight });
    }
  });
})();