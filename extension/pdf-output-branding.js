(() => {
  const REPOSITORY_URL = "https://github.com/il-prof-f-a/ebook2pdf-python/";
  const NOTICE_LINES = [
    "PDF scansionato con Ebook2PDF",
    REPOSITORY_URL,
    "Usare solo con contenuti per cui si dispone dei diritti o dell'autorizzazione alla copia.",
    "Chi riceve o utilizza questo PDF deve verificare di avere i diritti necessari.",
    "Uso, diffusione o condivisione non autorizzati di materiale protetto",
    "possono violare la normativa sul diritto d'autore e le condizioni d'uso."
  ];

  let sessionTitlePromise = null;

  async function getDocumentTabTitle() {
    try {
      if (globalThis.Ebook2PdfCaptureSession?.getTargetTab) {
        const tab = await globalThis.Ebook2PdfCaptureSession.getTargetTab();
        return String(tab?.title || "").trim();
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return String(tab?.title || "").trim();
    } catch (error) {
      console.warn("Ebook2PDF: impossibile leggere il titolo della scheda", error);
      return "";
    }
  }

  function sanitizeFilename(value) {
    let name = String(value || "").trim();
    name = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
    name = name.replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();

    if (/\.pdf$/i.test(name)) {
      name = name.replace(/\.pdf$/i, "").trim();
    }

    if (!name) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      name = `ebook2pdf_${stamp}`;
    }

    if (name.length > 180) name = name.slice(0, 180).trim();
    return name || "ebook2pdf";
  }

  async function getSessionTitle() {
    const title = await (sessionTitlePromise || getDocumentTabTitle());
    return sanitizeFilename(title);
  }

  async function addFirstPageNotice(pdfBytes, documentTitle) {
    if (!globalThis.Ebook2PdfNativePdf?.loadPdfLib) {
      throw new Error("pdf-lib non disponibile per aggiungere il disclaimer Ebook2PDF.");
    }

    const { PDFDocument, StandardFonts, rgb } = await globalThis.Ebook2PdfNativePdf.loadPdfLib();
    const document = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    if (!document.getPageCount()) return pdfBytes;

    document.setTitle(documentTitle);
    document.setCreator("Ebook2PDF");
    document.setProducer("Ebook2PDF");

    const page = document.getPage(0);
    const { width, height } = page.getSize();
    const font = await document.embedFont(StandardFonts.Helvetica);

    const fontSize = Math.max(5.5, Math.min(7.5, Math.min(width, height) / 95));
    const lineHeight = fontSize * 1.35;
    const paddingX = fontSize * 1.05;
    const paddingY = fontSize * 0.85;
    const margin = Math.max(8, fontSize * 1.5);

    let maxTextWidth = 0;
    for (const line of NOTICE_LINES) {
      maxTextWidth = Math.max(maxTextWidth, font.widthOfTextAtSize(line, fontSize));
    }

    const boxWidth = Math.min(width - margin * 2, maxTextWidth + paddingX * 2);
    const boxHeight = NOTICE_LINES.length * lineHeight + paddingY * 2;
    const x = Math.max(margin, width - margin - boxWidth);
    const y = margin;

    page.drawRectangle({
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      opacity: 0.90,
      borderColor: rgb(0.82, 0.82, 0.82),
      borderOpacity: 0.75,
      borderWidth: 0.5
    });

    NOTICE_LINES.forEach((line, index) => {
      const textWidth = font.widthOfTextAtSize(line, fontSize);
      const textX = Math.max(x + paddingX, x + boxWidth - paddingX - textWidth);
      const textY = y + boxHeight - paddingY - fontSize - index * lineHeight;
      page.drawText(line, {
        x: textX,
        y: textY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    });

    return new Uint8Array(await document.save({ useObjectStreams: false }));
  }

  async function downloadOutput(pdfBytes, searchable, documentTitle) {
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const suffix = searchable ? "_ocr" : "";
    const filename = `${sanitizeFilename(documentTitle)}${suffix}.pdf`;

    try {
      await chrome.downloads.download({
        url,
        filename,
        saveAs: true
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  async function brandedDownloadPdf(pages, searchable = false) {
    let pdfBytes;

    if (searchable) {
      if (!globalThis.Ebook2PdfNativePdf?.buildSearchablePdf) {
        throw new Error("Modulo PDF OCR nativo non disponibile.");
      }
      pdfBytes = await globalThis.Ebook2PdfNativePdf.buildSearchablePdf(pages);
    } else {
      if (typeof globalThis.buildImagePdf !== "function") {
        throw new Error("Generatore PDF immagini non disponibile.");
      }
      pdfBytes = globalThis.buildImagePdf(pages);
    }

    const documentTitle = await getSessionTitle();
    let outputBytes = pdfBytes;

    try {
      outputBytes = await addFirstPageNotice(pdfBytes, documentTitle);
    } catch (error) {
      console.warn("Ebook2PDF: disclaimer PDF non applicato", error);
      if (typeof globalThis.log === "function") {
        globalThis.log(`AVVISO: disclaimer Ebook2PDF non applicato (${error?.message || error}).`);
      }
    }

    await downloadOutput(outputBytes, searchable, documentTitle);
    return searchable;
  }

  const startButton = document.getElementById("start");
  startButton?.addEventListener("click", () => {
    sessionTitlePromise = getDocumentTabTitle();
  }, true);

  globalThis.downloadPdf = brandedDownloadPdf;
})();