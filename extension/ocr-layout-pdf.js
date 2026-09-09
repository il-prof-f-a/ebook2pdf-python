(() => {
  const OCR_DEFAULTS = Object.freeze({
    ocrPsm: "3",
    preserveInterwordSpaces: true
  });
  let ocrStopRequested = false;

  function $(id) {
    return document.getElementById(id);
  }

  function normalizePsm(value) {
    const psm = String(value ?? OCR_DEFAULTS.ocrPsm);
    return ["3", "4", "6", "11"].includes(psm) ? psm : OCR_DEFAULTS.ocrPsm;
  }

  function cleanTextPreserveSpaces(text) {
    return String(text || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function pdfLiteralPreserveSpaces(text) {
    const replacements = new Map([
      ["‘", "'"], ["’", "'"], ["‚", "'"],
      ["“", "\""], ["”", "\""], ["„", "\""],
      ["–", "-"], ["—", "-"], ["−", "-"],
      ["…", "..."], [" ", " "]
    ]);

    let normalized = "";
    for (const char of cleanTextPreserveSpaces(text)) {
      normalized += replacements.get(char) ?? char;
    }

    let out = "";
    for (const char of normalized) {
      if (char === "\\" || char === "(" || char === ")") {
        out += `\\${char}`;
        continue;
      }

      const code = char.charCodeAt(0);
      if (code >= 32 && code <= 126) {
        out += char;
      } else if (code >= 160 && code <= 255) {
        out += `\\${code.toString(8).padStart(3, "0")}`;
      } else {
        out += "?";
      }
    }

    return out;
  }

  function fallbackLinesFromWords(page) {
    const words = Array.isArray(page?.ocr?.words) ? page.ocr.words : [];
    return words.map(word => ({
      text: `${word.text} `,
      bbox: word.bbox,
      words: [word]
    }));
  }

  globalThis.buildOcrCommands = function buildStructuredOcrCommands(page, widthPt, heightPt) {
    const lines = Array.isArray(page?.ocr?.lines) && page.ocr.lines.length
      ? page.ocr.lines
      : fallbackLinesFromWords(page);
    if (!lines.length) return "";

    const scaleX = widthPt / page.width;
    const scaleY = heightPt / page.height;
    const commands = [];

    for (const line of lines) {
      const bbox = line?.bbox;
      const text = pdfLiteralPreserveSpaces(line?.text);
      if (!bbox || !text) continue;

      const boxWidth = Math.max(1, (bbox.x1 - bbox.x0) * scaleX);
      const boxHeight = Math.max(1, (bbox.y1 - bbox.y0) * scaleY);
      const fontSize = Math.min(72, Math.max(3, boxHeight * 0.88));
      const x = Math.max(0, bbox.x0 * scaleX);
      const y = Math.max(0, heightPt - (bbox.y1 * scaleY) + (fontSize * 0.10));
      const visibleChars = Math.max(1, cleanTextPreserveSpaces(line.text).length);
      const estimatedWidth = Math.max(1, visibleChars * fontSize * 0.50);
      const horizontalScale = Math.min(300, Math.max(20, (boxWidth / estimatedWidth) * 100));

      commands.push(
        `BT\n3 Tr\n/F1 ${fontSize.toFixed(2)} Tf\n${horizontalScale.toFixed(2)} Tz\n` +
        `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${text}) Tj\nET\n`
      );
    }

    return commands.join("");
  };

  const originalSettingsFromForm = globalThis.settingsFromForm;
  if (typeof originalSettingsFromForm === "function") {
    globalThis.settingsFromForm = function settingsFromFormWithOcrLayout() {
      return {
        ...originalSettingsFromForm(),
        ocrPsm: normalizePsm($("ocrPsm")?.value),
        preserveInterwordSpaces: $("preserveInterwordSpaces")?.checked !== false
      };
    };
  }

  const originalApplySettings = globalThis.applySettings;
  if (typeof originalApplySettings === "function") {
    globalThis.applySettings = function applySettingsWithOcrLayout(settings) {
      originalApplySettings(settings);
      const merged = { ...OCR_DEFAULTS, ...(settings || {}) };
      if ($("ocrPsm")) $("ocrPsm").value = normalizePsm(merged.ocrPsm);
      if ($("preserveInterwordSpaces")) {
        $("preserveInterwordSpaces").checked = merged.preserveInterwordSpaces !== false;
      }
    };
  }

  globalThis.runOcr = async function runStructuredOcr(pages, language) {
    if (!globalThis.Ebook2PdfOcr?.recognizePages) {
      throw new Error("Modulo OCR non disponibile.");
    }

    ocrStopRequested = false;
    $("ocrProgressBox").classList.remove("hidden");
    $("ocrProgress").value = 0;
    $("ocrProgressText").textContent = "Inizializzazione Tesseract...";
    if (typeof globalThis.setStep === "function") globalThis.setStep("2/3 — OCR locale");

    const psm = normalizePsm($("ocrPsm")?.value);
    const preserveSpaces = $("preserveInterwordSpaces")?.checked !== false;
    if (typeof globalThis.log === "function") {
      globalThis.log(`Avvio OCR locale su ${pages.length} pagine (${language}, PSM ${psm}, spazi ${preserveSpaces ? "preservati" : "standard"}).`);
    }

    await globalThis.Ebook2PdfOcr.recognizePages(pages, {
      language,
      pageSegMode: psm,
      preserveInterwordSpaces: preserveSpaces,
      shouldStop: () => ocrStopRequested,
      onProgress: message => {
        if (typeof globalThis.updateOcrProgress === "function") {
          globalThis.updateOcrProgress(message);
        }
      }
    });

    const recognizedPages = pages.filter(page => page?.ocr?.lines?.length || page?.ocr?.words?.length).length;
    if (typeof globalThis.log === "function") {
      globalThis.log(`OCR completato su ${recognizedPages}/${pages.length} pagine.`);
    }
    return recognizedPages > 0;
  };

  async function reloadStoredOcrSettings() {
    try {
      const key = "ebook2pdfSettings";
      const stored = await chrome.storage.local.get(key);
      if (typeof globalThis.applySettings === "function") {
        globalThis.applySettings(stored?.[key]);
      }
    } catch (error) {
      console.warn("Ebook2PDF: impossibile caricare le impostazioni OCR avanzate", error);
    }
  }

  $("start")?.addEventListener("click", () => {
    ocrStopRequested = false;
  }, true);

  $("stop")?.addEventListener("click", () => {
    ocrStopRequested = true;
  });

  $("resetSettings")?.addEventListener("click", () => {
    setTimeout(() => {
      if ($("ocrPsm")) $("ocrPsm").value = OCR_DEFAULTS.ocrPsm;
      if ($("preserveInterwordSpaces")) $("preserveInterwordSpaces").checked = true;
    }, 0);
  });

  reloadStoredOcrSettings();
})();