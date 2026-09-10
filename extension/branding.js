(() => {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = document.getElementById("appVersion");
    if (version) version.textContent = `v${manifest.version}`;
  } catch (error) {
    console.warn("Ebook2PDF: impossibile leggere i metadati del manifest", error);
  }

  function loadScript(path, onload) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(path);
    script.async = false;
    script.onload = onload || null;
    script.onerror = () => console.warn(`Ebook2PDF: impossibile caricare ${path}`);
    document.head.appendChild(script);
  }

  // Ordine intenzionale:
  // 1. resilienza della sessione/tab;
  // 2. gate di nitidezza prima della validazione DOM;
  // 3. nome file, metadata e disclaimer PDF.
  loadScript("capture-resilience.js", () => {
    loadScript("render-sharpness-gate.js", () => {
      loadScript("pdf-output-branding.js");
    });
  });
})();
