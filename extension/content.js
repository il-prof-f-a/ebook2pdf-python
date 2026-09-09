(() => {
  let overlay = null;

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
      if (current.classList.length) {
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
        resolve(rect.width >= 10 && rect.height >= 10 ? rect : null);
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
        const el = document.elementFromPoint(x, y);
        resolve(el ? { selector: selectorFor(el), text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80) } : null);
      }, { once: true });
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
        el.click();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
      return;
    }
    if (message?.type === "GET_VIEWPORT") {
      sendResponse({ ok: true, dpr: window.devicePixelRatio || 1, width: innerWidth, height: innerHeight });
    }
  });
})();