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

  function unionBboxes(items) {
    const boxes = items.map(item => normalizeBbox(item?.bbox)).filter(Boolean);
    if (!boxes.length) return null;
    return {
      x0: Math.min(...boxes.map(box => box.x0)),
      y0: Math.min(...boxes.map(box => box.y0)),
      x1: Math.max(...boxes.map(box => box.x1)),
      y1: Math.max(...boxes.map(box => box.y1))
    };
  }

  function normalizeWord(word) {
    const text = String(word?.text || "").trim();
    const bbox = normalizeBbox(word?.bbox);
    if (!text || !bbox) return null;
    return {
      text,
      bbox,
      confidence: Number.isFinite(Number(word?.confidence)) ? Number(word.confidence) : null
    };
  }

  function cleanLineText(text) {
    return String(text || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function textFromWords(words) {
    return words.map(word => word.text).join(" ").trim();
  }

  function normalizeLine(line, blockIndex, paragraphIndex, lineIndex) {
    const words = (line?.words || []).map(normalizeWord).filter(Boolean);
    const bbox = normalizeBbox(line?.bbox) || unionBboxes(words);
    const text = cleanLineText(line?.text) || textFromWords(words);
    if (!text || !bbox) return null;
    return {
      text,
      bbox,
      words,
      confidence: Number.isFinite(Number(line?.confidence)) ? Number(line.confidence) : null,
      blockIndex,
      paragraphIndex,
      lineIndex
    };
  }

  function verticalOverlapRatio(a, b) {
    const top = Math.max(a.y0, b.y0);
    const bottom = Math.min(a.y1, b.y1);
    const overlap = Math.max(0, bottom - top);
    const minHeight = Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
    return overlap / minHeight;
  }

  function joinFragments(left, right) {
    const a = cleanLineText(left);
    const b = cleanLineText(right);
    if (!a) return b;
    if (!b) return a;
    if (/[-–—/]$/.test(a) || /^[,.;:!?%\)\]\}]/.test(b)) return `${a}${b}`;
    return `${a} ${b}`;
  }

  function mergeSameRowFragments(lines) {
    const sorted = [...lines].sort((a, b) => {
      const dy = a.bbox.y0 - b.bbox.y0;
      return Math.abs(dy) > 2 ? dy : a.bbox.x0 - b.bbox.x0;
    });
    const merged = [];

    for (const line of sorted) {
      const previous = merged[merged.length - 1];
      const sameContainer = previous &&
        previous.blockIndex === line.blockIndex &&
        previous.paragraphIndex === line.paragraphIndex;
      const sameRow = sameContainer && verticalOverlapRatio(previous.bbox, line.bbox) >= 0.60;

      if (!sameRow) {
        merged.push({ ...line, words: [...line.words] });
        continue;
      }

      const fragments = [previous, line].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      previous.text = joinFragments(fragments[0].text, fragments[1].text);
      previous.words = [...previous.words, ...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      previous.bbox = unionBboxes([previous, line]);
      if (previous.confidence != null && line.confidence != null) {
        previous.confidence = (previous.confidence + line.confidence) / 2;
      }
    }

    return merged;
  }

  function extractLayout(data) {
    const blocksOut = [];
    const paragraphsOut = [];
    const linesOut = [];
    const wordsOut = [];
    const sourceBlocks = Array.isArray(data?.blocks) ? data.blocks : [];

    sourceBlocks.forEach((block, blockIndex) => {
      const blockOut = {
        bbox: normalizeBbox(block?.bbox),
        text: cleanLineText(block?.text),
        paragraphs: []
      };

      for (const [paragraphIndex, paragraph] of (block?.paragraphs || []).entries()) {
        const rawLines = (paragraph?.lines || [])
          .map((line, lineIndex) => normalizeLine(line, blockIndex, paragraphIndex, lineIndex))
          .filter(Boolean);
        const lines = mergeSameRowFragments(rawLines);

        const paragraphOut = {
          bbox: normalizeBbox(paragraph?.bbox) || unionBboxes(lines),
          text: cleanLineText(paragraph?.text) || lines.map(line => line.text).join("\n"),
          lines
        };

        blockOut.paragraphs.push(paragraphOut);
        paragraphsOut.push(paragraphOut);
        linesOut.push(...lines);
        for (const line of lines) wordsOut.push(...line.words);
      }

      if (blockOut.paragraphs.length) blocksOut.push(blockOut);
    });

    // Fallback per output Tesseract privi di blocks.
    if (!linesOut.length && Array.isArray(data?.lines)) {
      const lines = mergeSameRowFragments(
        data.lines.map((line, index) => normalizeLine(line, 0, 0, index)).filter(Boolean)
      );
      linesOut.push(...lines);
      for (const line of lines) wordsOut.push(...line.words);
    }

    if (!wordsOut.length && Array.isArray(data?.words)) {
      for (const word of data.words) {
        const normalized = normalizeWord(word);
        if (normalized) wordsOut.push(normalized);
      }
    }

    return {
      blocks: blocksOut,
      paragraphs: paragraphsOut,
      lines: linesOut,
      words: wordsOut
    };
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
      pageSegMode = "3",
      preserveInterwordSpaces = true,
      onProgress = () => {},
      shouldStop = () => false
    } = options;

    const Tesseract = await loadTesseractApi();
    const languages = normalizeLanguages(language);
    const psm = normalizePsm(pageSegMode);
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

        onProgress({
          phase: "page-start",
          pageIndex: index,
          totalPages: pages.length,
          status: `Avvio riconoscimento (PSM ${psm})`,
          progress: 0
        });

        const imageBlob = new Blob([pages[index].jpeg], { type: "image/jpeg" });
        const result = await worker.recognize(imageBlob, {}, { blocks: true });
        const layout = extractLayout(result?.data);

        pages[index].ocr = {
          text: String(result?.data?.text || ""),
          blocks: layout.blocks,
          paragraphs: layout.paragraphs,
          lines: layout.lines,
          words: layout.words,
          psm,
          preserveInterwordSpaces: !!preserveInterwordSpaces
        };

        onProgress({
          phase: "page-done",
          pageIndex: index,
          totalPages: pages.length,
          status: `${layout.lines.length} righe, ${layout.words.length} parole`,
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