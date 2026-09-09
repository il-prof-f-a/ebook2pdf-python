(() => {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = document.getElementById("appVersion");
    if (version) version.textContent = `v${manifest.version}`;
  } catch (error) {
    console.warn("Ebook2PDF: impossibile leggere i metadati del manifest", error);
  }
})();