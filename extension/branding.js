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
  // 2. compressione JPEG configurabile;
  // 3. convergenza temporale + blocker di caricamento;
  // 4. nome file, metadata e disclaimer PDF.
  loadScript("capture-resilience.js", () => {
    loadScript("jpeg-compression.js", () => {
      loadScript("render-readiness-convergence.js", () => {
        loadScript("pdf-output-branding.js");
      });
    });
  });
})();
