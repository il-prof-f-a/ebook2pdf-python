(() => {
  let tesseractLoadPromise = null;

  function extensionUrl(path) {
    return chrome.runtime.getURL(path);
  }

  function loadTesseractApi() {
    if (globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
    if (tesseractLoadPromise) return tesseractLoadPromise;

    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = extensionUrl("lib/tesseract/tesseract.min.js");
      script.async = true;
      script.onload = () => {
        if (globalThis.Tesseract?.createWorker) {
          resolve(globalThis.Tesseract);
        } else {
          reject(new Error("Tesseract caricato, ma l'API createWorker non è disponibile."));
        }
      };
      script.onerror = () => reject(new Error(
        "Asset OCR non trovati. Riesegui lo script di installazione degli asset e ricarica l'estensione."
      ));
      document.head.appendChild(script);
    });

    return tesseractLoadPromise;
  }

  function normalizeLanguages(language) {
    if (Array.isArray(language)) return language;
    return String(language || "ita+eng")
      .split("+")
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizePsm(value) {
    const psm = String(value ?? "3");
    return ["3", "4", "6", "11"].includes(psm) ? psm : "3";
  }

  function normalizeScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale)) return 2;
    return Math.min(3, Math.max(1, scale));
  }

  async function verifyLocalAsset(path, label) {
    const url = extensionUrl(path);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return url;
    } catch (error) {
      throw new Error(`${label} non disponibile (${path}): ${error?.message || error}`);
    }
  }

  async function prepareOcrImage(page, scale) {
    const source = new Blob([page.jpeg], { type: "image/jpeg" });
    if (scale <= 1.01) return source;

    const bitmap = await createImageBitmap(source);
    const width = Math.max(1, Math.round(page.width * scale));
    const height = Math.max(1, Math.round(page.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // L'upscale serve soltanto al motore OCR. Il PDF finale riutilizza il JPEG originale.
    return canvas.convertToBlob({ type: "image/png" });
  }

  function pageBaseDpi(page) {
    // Mantiene la stessa scala fisica del precedente PDF: lato massimo <= 842 pt.
    const maxPixels = Math.max(1, Number(page.width) || 1, Number(page.height) || 1);
    return Math.max(70, (maxPixels * 72) / 842);
  }

  function normalizePdfBytes(pdf) {
    if (pdf instanceof Uint8Array) return pdf;
    if (pdf instanceof ArrayBuffer) return new Uint8Array(pdf);
    if (ArrayBuffer.isView(pdf)) {
      return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
    }
    if (Array.isArray(pdf)) return Uint8Array.from(pdf);
    return null;
  }

  async function recognizePages(pages, options = {}) {
    const {
      language = "ita+eng",
      pageSegMode = "3",
      preserveInterwordSpaces = true,
      scale = 2,
      onProgress = () => {},
      shouldStop = () => false
    } = options;

    const Tesseract = await loadTesseractApi();
    const languages = normalizeLanguages(language);
    const psm = normalizePsm(pageSegMode);
    const ocrScale = normalizeScale(scale);
    let currentPage = 0;
    let worker = null;

    const workerPath = await verifyLocalAsset("lib/tesseract/worker.min.js", "Worker Tesseract");
    const corePath = extensionUrl("lib/tesseract-core");
    const langPath = extensionUrl("tessdata");

    for (const lang of languages) {
      await verifyLocalAsset(`tessdata/${lang}.traineddata.gz`, `Modello OCR ${lang}`);
    }

    try {
      worker = await Tesseract.createWorker(languages, 1, {
        workerPath,
        corePath,
        langPath,
        workerBlobURL: false,
        logger: message => {
          const progress = Number.isFinite(Number(message?.progress)) ? Number(message.progress) : 0;
          onProgress({
            phase: "worker",
            pageIndex: currentPage,
            totalPages: pages.length,
            status: String(message?.status || "OCR"),
            progress: Math.min(1, Math.max(0, progress))
          });
        },
        errorHandler: error => {
          console.error("Ebook2PDF Tesseract worker error:", error);
        }
      });

      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: preserveInterwordSpaces ? "1" : "0"
      });

      for (let index = 0; index < pages.length; index++) {
        if (shouldStop()) break;
        currentPage = index;
        const page = pages[index];

        onProgress({
          phase: "page-start",
          pageIndex: index,
          totalPages: pages.length,
          status: `Preparazione OCR ${ocrScale.toFixed(1)}× (PSM ${psm})`,
          progress: 0
        });

        const imageBlob = await prepareOcrImage(page, ocrScale);
        const dpi = Math.round(pageBaseDpi(page) * ocrScale);
        await worker.setParameters({ user_defined_dpi: String(dpi) });

        const result = await worker.recognize(
          imageBlob,
          {
            pdfTitle: `Ebook2PDF - pagina ${index + 1}`,
            pdfTextOnly: true
          },
          { pdf: true }
        );

        const pdfBytes = normalizePdfBytes(result?.data?.pdf);
        if (!pdfBytes?.length) {
          throw new Error(`Tesseract non ha prodotto il PDF text-only per la pagina ${index + 1}.`);
        }

        page.ocrPdf = pdfBytes;
        page.ocrText = String(result?.data?.text || "");
        page.ocr = {
          text: page.ocrText,
          psm,
          preserveInterwordSpaces: !!preserveInterwordSpaces,
          scale: ocrScale,
          dpi
        };

        const chars = page.ocrText.trim().length;
        onProgress({
          phase: "page-done",
          pageIndex: index,
          totalPages: pages.length,
          status: `${chars} caratteri riconosciuti`,
          progress: 1
        });
      }

      return pages;
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {
          // Il worker può essere già terminato o non più raggiungibile.
        }
      }
    }
  }

  globalThis.Ebook2PdfOcr = {
    recognizePages,
    loadTesseractApi
  };
})();