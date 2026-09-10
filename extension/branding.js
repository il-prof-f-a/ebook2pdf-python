(() => {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = document.getElementById("appVersion");
    if (version) version.textContent = `v${manifest.version}`;
  } catch (error) {
    console.warn("Ebook2PDF: impossibile leggere i metadati del manifest", error);
  }

  // Carica le personalizzazioni del PDF dopo sidepanel.js e il gestore
  // della modalità Tutte, così può sostituire il generatore di download
  // senza duplicare la logica di acquisizione.
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("pdf-output-branding.js");
  script.async = false;
  script.onerror = () => console.warn(
    "Ebook2PDF: impossibile caricare le personalizzazioni del PDF"
  );
  document.head.appendChild(script);
})();