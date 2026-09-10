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

  // Prima installa il gestore che mantiene legata la sessione alla scheda
  // del documento; poi applica nome file, metadata e disclaimer PDF.
  loadScript("capture-resilience.js", () => {
    loadScript("pdf-output-branding.js");
  });
})();