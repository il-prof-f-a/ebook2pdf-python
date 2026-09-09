(() => {
  let pdfLibLoadPromise = null;

  function extensionUrl(path) {
    return chrome.runtime.getURL(path);
  }

  function loadPdfLib() {
    if (globalThis.PDFLib?.PDFDocument) return Promise.resolve(globalThis.PDFLib);
    if (pdfLibLoadPromise) return pdfLibLoadPromise;

    pdfLibLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = extensionUrl("lib/pdf-lib/pdf-lib.min.js");
      script.async = true;
      script.onload = () => {
        if (globalThis.PDFLib?.PDFDocument) {
          resolve(globalThis.PDFLib);
        } else {
          reject(new Error("pdf-lib caricato, ma PDFDocument non è disponibile."));
        }
      };
      script.onerror = () => reject(new Error(
        "Asset pdf-lib non trovato. Riesegui extension/scripts/install-tesseract-assets.ps1 e ricarica l'estensione."
      ));
      document.head.appendChild(script);
    });

    return pdfLibLoadPromise;
  }

  async function buildSearchablePdf(pages) {
    if (!Array.isArray(pages) || !pages.length) {
      throw new Error("Nessuna pagina disponibile per il PDF OCR.");
    }

    const { PDFDocument } = await loadPdfLib();
    const output = await PDFDocument.create();
    output.setProducer("Ebook2PDF + Tesseract.js");
    output.setCreator("Ebook2PDF");

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const textPdfBytes = page?.ocrPdf;
      if (!(textPdfBytes instanceof Uint8Array) || !textPdfBytes.length) {
        throw new Error(`Layer PDF OCR mancante per la pagina ${index + 1}.`);
      }

      const textDocument = await PDFDocument.load(textPdfBytes, { ignoreEncryption: true });
      if (!textDocument.getPageCount()) {
        throw new Error(`PDF OCR vuoto per la pagina ${index + 1}.`);
      }

      const [copiedPage] = await output.copyPages(textDocument, [0]);
      output.addPage(copiedPage);

      const { width, height } = copiedPage.getSize();
      const image = await output.embedJpg(page.jpeg);

      // Il PDF Tesseract è text-only: il testo invisibile è già nella pagina.
      // L'immagine originale viene aggiunta senza ricostruire manualmente il text layer.
      copiedPage.drawImage(image, {
        x: 0,
        y: 0,
        width,
        height
      });
    }

    return new Uint8Array(await output.save({ useObjectStreams: false }));
  }

  globalThis.Ebook2PdfNativePdf = {
    loadPdfLib,
    buildSearchablePdf
  };
})();