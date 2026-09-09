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
        "Asset OCR non trovati. Aggiungi Tesseract.js in extension/lib/tesseract/ e consulta OCR_ASSETS.md."
      ));
      document.head.appendChild(script);
    });

    return tesseractLoadPromise;
  }

  function normalizeBbox(bbox) {
    if (!bbox) return null;
    const x0 = Number(bbox.x0);
    const y0 = Number(bbox.y0);
    const x1 = Number(bbox.x1);
    const y1 = Number(bbox.y1);
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    if (x1 <= x0 || y1 <= y0) return null;
    return { x0, y0, x1, y1 };
  }

  function flattenWords(data) {
    const output = [];

    const pushWord = word => {
      const text = String(word?.text || "").trim();
      const bbox = normalizeBbox(word?.bbox);
      if (!text || !bbox) return;
      output.push({
        text,
        bbox,
        confidence: Number.isFinite(Number(word?.confidence)) ? Number(word.confidence) : null
      });
    };

    if (Array.isArray(data?.words)) {
      data.words.forEach(pushWord);
      if (output.length) return output;
    }

    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    for (const block of blocks) {
      for (const paragraph of block?.paragraphs || []) {
        for (const line of paragraph?.lines || []) {
          for (const word of line?.words || []) pushWord(word);
        }
      }
    }

    return output;
  }

  function normalizeLanguages(language) {
    if (Array.isArray(language)) return language;
    return String(language || "ita+eng")
      .split("+")
      .map(item => item.trim())
      .filter(Boolean);
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

  async function recognizePages(pages, options = {}) {
    const {
      language = "ita+eng",
      onProgress = () => {},
      shouldStop = () => false
    } = options;

    const Tesseract = await loadTesseractApi();
    const languages = normalizeLanguages(language);
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

      for (let index = 0; index < pages.length; index++) {
        if (shouldStop()) break;
        currentPage = index;

        onProgress({
          phase: "page-start",
          pageIndex: index,
          totalPages: pages.length,
          status: "Avvio riconoscimento",
          progress: 0
        });

        const imageBlob = new Blob([pages[index].jpeg], { type: "image/jpeg" });
        const result = await worker.recognize(imageBlob, {}, { blocks: true });
        const words = flattenWords(result?.data);

        pages[index].ocr = {
          text: String(result?.data?.text || ""),
          words
        };

        onProgress({
          phase: "page-done",
          pageIndex: index,
          totalPages: pages.length,
          status: `${words.length} parole riconosciute`,
          progress: 1
        });
      }

      return pages;
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {
          // Niente da fare: il worker è già terminato o non è più raggiungibile.
        }
      }
    }
  }

  globalThis.Ebook2PdfOcr = {
    recognizePages,
    loadTesseractApi
  };
})();