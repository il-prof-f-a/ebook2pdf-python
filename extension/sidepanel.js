let region = null;
let nextTarget = null;
let stopRequested = false;

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const SETTINGS_KEY = "ebook2pdfSettings";
const DEFAULT_SETTINGS = Object.freeze({
  delay: 1.5,
  retryDelay: 2.0,
  attempts: 5,
  sharpnessRatio: 0.50,
  checkDuplicates: true,
  checkQuality: true,
  ocrLanguage: "ita+eng",
  ocrPsm: "3",
  preserveInterwordSpaces: true,
  ocrScale: 2.0
});

function log(message) {
  const time = new Date().toLocaleTimeString();
  $("log").textContent += `[${time}] ${message}\n`;
  $("log").scrollTop = $("log").scrollHeight;
}

function setStep(text) {
  $("stepText").textContent = text;
}

function languageLabel(value) {
  if (value === "ita") return "Italiano";
  if (value === "eng") return "Inglese";
  return "Italiano + Inglese";
}

function normalizeRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return DEFAULT_SETTINGS.sharpnessRatio;
  return Math.min(1, Math.max(0.05, ratio));
}

function normalizePsm(value) {
  const psm = String(value ?? DEFAULT_SETTINGS.ocrPsm);
  return ["3", "4", "6", "11"].includes(psm) ? psm : DEFAULT_SETTINGS.ocrPsm;
}

function normalizeOcrScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return DEFAULT_SETTINGS.ocrScale;
  return Math.min(3, Math.max(1, scale));
}

function normalizeSettings(settings) {
  const source = settings || {};
  let ratio = source.sharpnessRatio;
  if (ratio == null) {
    const legacy = Number(source.sharpness);
    ratio = Number.isFinite(legacy) && legacy > 0 && legacy <= 1
      ? legacy
      : DEFAULT_SETTINGS.sharpnessRatio;
  }

  return {
    delay: Math.max(0.2, Number(source.delay) || DEFAULT_SETTINGS.delay),
    retryDelay: Math.max(0.5, Number(source.retryDelay) || DEFAULT_SETTINGS.retryDelay),
    attempts: Math.min(20, Math.max(1, Number(source.attempts) || DEFAULT_SETTINGS.attempts)),
    sharpnessRatio: normalizeRatio(ratio),
    checkDuplicates: source.checkDuplicates !== false,
    checkQuality: source.checkQuality !== false,
    ocrLanguage: ["ita", "eng", "ita+eng"].includes(source.ocrLanguage) ? source.ocrLanguage : DEFAULT_SETTINGS.ocrLanguage,
    ocrPsm: normalizePsm(source.ocrPsm),
    preserveInterwordSpaces: source.preserveInterwordSpaces !== false,
    ocrScale: normalizeOcrScale(source.ocrScale)
  };
}

function applySettings(settings) {
  const merged = normalizeSettings(settings);
  $("delay").value = merged.delay;
  $("retryDelay").value = merged.retryDelay;
  $("attempts").value = merged.attempts;
  $("sharpnessRatio").value = merged.sharpnessRatio;
  $("checkDuplicates").checked = merged.checkDuplicates;
  $("checkQuality").checked = merged.checkQuality;
  $("ocrLanguage").value = merged.ocrLanguage;
  $("ocrPsm").value = merged.ocrPsm;
  $("preserveInterwordSpaces").checked = merged.preserveInterwordSpaces;
  $("ocrScale").value = merged.ocrScale;
  $("ocrLanguageSummary").textContent = `Lingua OCR: ${languageLabel(merged.ocrLanguage)}`;
}

function settingsFromForm() {
  return normalizeSettings({
    delay: $("delay").value,
    retryDelay: $("retryDelay").value,
    attempts: $("attempts").value,
    sharpnessRatio: $("sharpnessRatio").value,
    checkDuplicates: $("checkDuplicates").checked,
    checkQuality: $("checkQuality").checked,
    ocrLanguage: $("ocrLanguage").value,
    ocrPsm: $("ocrPsm").value,
    preserveInterwordSpaces: $("preserveInterwordSpaces").checked,
    ocrScale: $("ocrScale").value
  });
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = normalizeSettings(stored?.[SETTINGS_KEY]);
    applySettings(settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } catch (error) {
    applySettings(DEFAULT_SETTINGS);
    console.warn("Ebook2PDF: impossibile leggere le impostazioni", error);
  }
}

async function saveSettings() {
  const settings = settingsFromForm();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  applySettings(settings);
  $("settingsStatus").textContent = "Impostazioni salvate.";
  return settings;
}

function showSettings(show) {
  $("mainView").classList.toggle("hidden", show);
  $("settingsView").classList.toggle("hidden", !show);
  $("settingsButton").classList.toggle("hidden", show);
  if (!show) {
    $("ocrLanguageSummary").textContent = `Lingua OCR: ${languageLabel($("ocrLanguage").value)}`;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Nessuna scheda attiva");
  return tab;
}

async function sendToTab(message) {
  const tab = await activeTab();
  return chrome.tabs.sendMessage(tab.id, message);
}

async function captureVisible() {
  const response = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
  if (!response?.ok) throw new Error(response?.error || "Cattura non riuscita");
  return response.dataUrl;
}

async function cropCapture(dataUrl, selection) {
  const viewport = await sendToTab({ type: "GET_VIEWPORT" });
  if (!viewport?.ok) throw new Error("Impossibile leggere la viewport");

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;
  const sx = Math.max(0, Math.round(selection.x * scaleX));
  const sy = Math.max(0, Math.round(selection.y * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(selection.width * scaleX)));
  const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(selection.height * scaleY)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, sw, sh);
  const jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.90 });
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());

  return { width: sw, height: sh, imageData, jpeg };
}

function quadrantStats(imageData, x0, y0, width, height) {
  const { data, width: fullWidth } = imageData;
  let minGray = 255;
  let maxGray = 0;
  let gradientSum = 0;
  let gradientCount = 0;

  const x1 = Math.min(fullWidth, x0 + width);
  const y1 = Math.min(imageData.height, y0 + height);

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * fullWidth + x) * 4;
      const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      minGray = Math.min(minGray, gray);
      maxGray = Math.max(maxGray, gray);

      if (x + 2 < x1) {
        const j = (y * fullWidth + x + 2) * 4;
        const grayRight = (data[j] * 0.299) + (data[j + 1] * 0.587) + (data[j + 2] * 0.114);
        gradientSum += Math.abs(gray - grayRight);
        gradientCount++;
      }
      if (y + 2 < y1) {
        const j = ((y + 2) * fullWidth + x) * 4;
        const grayDown = (data[j] * 0.299) + (data[j + 1] * 0.587) + (data[j + 2] * 0.114);
        gradientSum += Math.abs(gray - grayDown);
        gradientCount++;
      }
    }
  }

  return {
    range: maxGray - minGray,
    sharpness: gradientCount ? gradientSum / gradientCount : 0
  };
}

function validateImage(imageData, baselineSharpness, ratio) {
  const halfW = Math.max(1, Math.floor(imageData.width / 2));
  const halfH = Math.max(1, Math.floor(imageData.height / 2));
  const tl = quadrantStats(imageData, 0, 0, halfW, halfH);
  const br = quadrantStats(imageData, halfW, halfH, imageData.width - halfW, imageData.height - halfH);

  if (tl.range <= 3 || br.range <= 3) {
    return { ok: false, type: "monochrome", reason: "uno dei quadranti è quasi monocolore" };
  }

  const sharpness = Math.min(tl.sharpness, br.sharpness);
  const normalizedRatio = normalizeRatio(ratio);

  if (baselineSharpness == null) {
    return {
      ok: true,
      sharpness,
      reason: `baseline nitidezza ${sharpness.toFixed(2)} (ratio ${normalizedRatio.toFixed(2)})`
    };
  }

  const threshold = baselineSharpness * normalizedRatio;
  if (sharpness < threshold) {
    return {
      ok: false,
      type: "blurry",
      sharpness,
      threshold,
      reason: `nitidezza ${sharpness.toFixed(2)} sotto soglia ${threshold.toFixed(2)} (baseline ${baselineSharpness.toFixed(2)} × ratio ${normalizedRatio.toFixed(2)})`
    };
  }

  return {
    ok: true,
    sharpness,
    threshold,
    reason: `nitidezza ${sharpness.toFixed(2)} (soglia ${threshold.toFixed(2)})`
  };
}

function imageDifference(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 1;
  const da = a.data;
  const db = b.data;
  let diff = 0;
  let samples = 0;

  for (let i = 0; i < da.length; i += 16) {
    diff += Math.abs(da[i] - db[i]);
    diff += Math.abs(da[i + 1] - db[i + 1]);
    diff += Math.abs(da[i + 2] - db[i + 2]);
    samples += 3;
  }

  return samples ? diff / (samples * 255) : 1;
}

function encode(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function buildImagePdf(pages) {
  const objects = new Map();
  const kids = [];
  objects.set(1, encode("<< /Type /Catalog /Pages 2 0 R >>"));

  pages.forEach((page, index) => {
    const pageObj = 3 + index * 3;
    const imageObj = pageObj + 1;
    const contentObj = pageObj + 2;
    kids.push(`${pageObj} 0 R`);

    const maxPt = 842;
    const scale = Math.min(1, maxPt / Math.max(page.width, page.height));
    const widthPt = Math.max(1, page.width * scale);
    const heightPt = Math.max(1, page.height * scale);

    objects.set(pageObj, encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
    ));

    const imageHeader = encode(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
    );
    objects.set(imageObj, concatBytes([imageHeader, page.jpeg, encode("\nendstream")]));

    const content = encode(`q\n${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`);
    objects.set(contentObj, concatBytes([
      encode(`<< /Length ${content.length} >>\nstream\n`),
      content,
      encode("endstream")
    ]));
  });

  objects.set(2, encode(`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>`));

  const maxObject = 2 + pages.length * 3;
  const header = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A,
    0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A
  ]);
  const chunks = [header];
  const offsets = new Array(maxObject + 1).fill(0);
  let cursor = header.length;

  for (let n = 1; n <= maxObject; n++) {
    const body = objects.get(n);
    offsets[n] = cursor;
    const objectBytes = concatBytes([encode(`${n} 0 obj\n`), body, encode("\nendobj\n")]);
    chunks.push(objectBytes);
    cursor += objectBytes.length;
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObject; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(encode(xref));

  return concatBytes(chunks);
}

async function downloadBytes(pdfBytes, searchable) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = searchable ? "_ocr" : "";
  try {
    await chrome.downloads.download({
      url,
      filename: `ebook2pdf_${stamp}${suffix}.pdf`,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function downloadPdf(pages, searchable = false) {
  if (searchable) {
    if (!globalThis.Ebook2PdfNativePdf?.buildSearchablePdf) {
      throw new Error("Modulo PDF OCR nativo non disponibile.");
    }
    const pdf = await globalThis.Ebook2PdfNativePdf.buildSearchablePdf(pages);
    await downloadBytes(pdf, true);
    return true;
  }

  await downloadBytes(buildImagePdf(pages), false);
  return false;
}

function updateOcrProgress(message) {
  const total = Math.max(1, Number(message.totalPages) || 1);
  const index = Math.max(0, Number(message.pageIndex) || 0);
  const localProgress = Math.min(1, Math.max(0, Number(message.progress) || 0));
  const completed = message.phase === "page-done" ? index + 1 : index + localProgress;
  const globalProgress = Math.min(1, completed / total);

  $("ocrProgress").max = 1;
  $("ocrProgress").value = globalProgress;
  $("ocrProgressText").textContent =
    `Pagina ${Math.min(total, index + 1)}/${total} — ${message.status || "OCR"} — ${Math.round(globalProgress * 100)}%`;
}

async function runOcr(pages, settings) {
  if (!globalThis.Ebook2PdfOcr?.recognizePages) {
    throw new Error("Modulo OCR non disponibile.");
  }

  $("ocrProgressBox").classList.remove("hidden");
  $("ocrProgress").value = 0;
  $("ocrProgressText").textContent = "Inizializzazione Tesseract...";
  setStep("2/3 — OCR locale");
  log(
    `Avvio OCR locale su ${pages.length} pagine ` +
    `(${settings.ocrLanguage}, PSM ${settings.ocrPsm}, upscale ${settings.ocrScale.toFixed(1)}×).`
  );

  await globalThis.Ebook2PdfOcr.recognizePages(pages, {
    language: settings.ocrLanguage,
    pageSegMode: settings.ocrPsm,
    preserveInterwordSpaces: settings.preserveInterwordSpaces,
    scale: settings.ocrScale,
    shouldStop: () => stopRequested,
    onProgress: updateOcrProgress
  });

  if (stopRequested) {
    log("OCR interrotto: verrà creato il PDF normale con tutte le pagine acquisite.");
    return false;
  }

  const completed = pages.filter(page => page?.ocrPdf instanceof Uint8Array && page.ocrPdf.length).length;
  const chars = pages.reduce((sum, page) => sum + String(page?.ocrText || "").trim().length, 0);
  log(`OCR completato su ${completed}/${pages.length} pagine (${chars} caratteri).`);
  return completed === pages.length;
}

$("settingsButton").addEventListener("click", () => {
  $("settingsStatus").textContent = "";
  showSettings(true);
});

$("closeSettings").addEventListener("click", async () => {
  await saveSettings();
  showSettings(false);
});

$("saveSettings").addEventListener("click", async () => {
  await saveSettings();
});

$("resetSettings").addEventListener("click", async () => {
  applySettings(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } });
  $("settingsStatus").textContent = "Impostazioni predefinite ripristinate.";
});

$("ocrLanguage").addEventListener("change", () => {
  $("ocrLanguageSummary").textContent = `Lingua OCR: ${languageLabel($("ocrLanguage").value)}`;
});

$("selectRegion").addEventListener("click", async () => {
  try {
    const result = await sendToTab({ type: "SELECT_REGION" });
    if (!result?.ok) return;
    region = result.region;
    $("regionStatus").textContent = `${Math.round(region.width)}×${Math.round(region.height)} px CSS`;
    log("Area pagina selezionata.");
  } catch (error) {
    log(`ERRORE selezione area: ${error}`);
  }
});

$("selectNext").addEventListener("click", async () => {
  try {
    const result = await sendToTab({ type: "SELECT_NEXT" });
    if (!result?.ok) return;
    nextTarget = result.target;
    $("nextStatus").textContent = nextTarget.text || nextTarget.selector;
    log(`Comando avanti: ${nextTarget.selector}`);
  } catch (error) {
    log(`ERRORE selezione comando avanti: ${error}`);
  }
});

$("stop").addEventListener("click", () => {
  stopRequested = true;
  log("Arresto richiesto: terminerò dopo l'operazione corrente e creerò il PDF con quanto disponibile.");
});

$("start").addEventListener("click", async () => {
  if (!region || !nextTarget) {
    log("Seleziona prima area pagina e comando avanti.");
    return;
  }

  const totalPages = Math.max(1, Number($("pages").value) || 1);
  const settings = settingsFromForm();
  const delayMs = settings.delay * 1000;
  const retryDelayMs = settings.retryDelay * 1000;
  const maxAttempts = settings.attempts;
  const checkDuplicates = settings.checkDuplicates;
  const checkQuality = settings.checkQuality;
  const enableOcr = $("enableOcr").checked;

  stopRequested = false;
  $("start").disabled = true;
  $("stop").disabled = false;
  $("progress").max = totalPages;
  $("progress").value = 0;
  $("log").textContent = "";
  $("ocrProgressBox").classList.add("hidden");
  setStep(enableOcr ? "1/3 — Acquisizione" : "1/2 — Acquisizione");
  log(
    `Parametri: ratio nitidezza ${settings.sharpnessRatio.toFixed(2)}, ` +
    `retry ${settings.retryDelay.toFixed(1)}s, ${maxAttempts} tentativi.`
  );

  const pages = [];
  const skipped = [];
  let previousImageData = null;
  let baselineSharpness = null;
  let searchablePdf = false;

  try {
    for (let pageIndex = 0; pageIndex < totalPages && !stopRequested; pageIndex++) {
      let accepted = null;
      let lastReason = "";

      for (let attempt = 1; attempt <= maxAttempts && !stopRequested; attempt++) {
        if (pageIndex > 0 || attempt > 1) {
          await sleep(attempt === 1 ? delayMs : retryDelayMs);
        }

        const capture = await cropCapture(await captureVisible(), region);

        if (checkDuplicates && previousImageData) {
          const difference = imageDifference(capture.imageData, previousImageData);
          if (difference < 0.002) {
            lastReason = `duplicata (differenza ${(difference * 100).toFixed(3)}%)`;
            log(`Pagina ${pageIndex + 1}, tentativo ${attempt}: ${lastReason}`);
            continue;
          }
        }

        if (checkQuality) {
          const validation = validateImage(capture.imageData, baselineSharpness, settings.sharpnessRatio);
          lastReason = validation.reason;
          if (!validation.ok) {
            const edgePage = pageIndex === 0 || pageIndex === totalPages - 1;
            if (!(validation.type === "blurry" && edgePage)) {
              log(`Pagina ${pageIndex + 1}, tentativo ${attempt}: ${validation.reason}`);
              continue;
            }
            log(`Pagina ${pageIndex + 1}: accettata pur sotto soglia perché iniziale/finale.`);
          }
          if (baselineSharpness == null && validation.sharpness != null) {
            baselineSharpness = validation.sharpness;
            log(`Baseline nitidezza impostata a ${baselineSharpness.toFixed(2)}.`);
          }
        }

        accepted = capture;
        break;
      }

      if (accepted) {
        pages.push({ width: accepted.width, height: accepted.height, jpeg: accepted.jpeg });
        previousImageData = accepted.imageData;
        log(`Pagina ${pageIndex + 1}/${totalPages} acquisita.`);
      } else if (!stopRequested) {
        skipped.push(pageIndex + 1);
        log(`Pagina ${pageIndex + 1} saltata dopo ${maxAttempts} tentativi${lastReason ? `: ${lastReason}` : "."}`);
      }

      $("progress").value = pageIndex + 1;
      $("progressText").textContent = `${pageIndex + 1}/${totalPages} — salvate ${pages.length}, saltate ${skipped.length}`;

      if (pageIndex < totalPages - 1 && !stopRequested) {
        const clicked = await sendToTab({ type: "CLICK_NEXT", selector: nextTarget.selector });
        if (!clicked?.ok) throw new Error(clicked?.error || "Impossibile avanzare alla pagina successiva");
      }
    }

    if (!pages.length) {
      log("Nessuna pagina valida: PDF non creato.");
      setStep("Operazione terminata senza pagine valide.");
      return;
    }

    if (enableOcr && !stopRequested) {
      try {
        searchablePdf = await runOcr(pages, settings);
      } catch (ocrError) {
        searchablePdf = false;
        log(`ERRORE OCR: ${ocrError?.message || ocrError}`);
        log("Creo comunque il PDF acquisito, senza OCR.");
      }
    } else if (enableOcr && stopRequested) {
      log("OCR saltato perché è stato richiesto l'arresto durante l'acquisizione.");
    }

    setStep(enableOcr ? "3/3 — Creazione PDF" : "2/2 — Creazione PDF");

    let downloadedAsSearchable = false;
    if (searchablePdf) {
      try {
        log("Compongo il PDF: immagine originale + layer text-only nativo di Tesseract...");
        downloadedAsSearchable = await downloadPdf(pages, true);
      } catch (pdfError) {
        log(`ERRORE composizione PDF OCR: ${pdfError?.message || pdfError}`);
        log("Fallback: creo il PDF normale con le immagini acquisite.");
        await downloadPdf(pages, false);
      }
    } else {
      log(`Creo PDF con ${pages.length} pagine...`);
      await downloadPdf(pages, false);
    }

    log(downloadedAsSearchable
      ? "PDF ricercabile con layer Tesseract nativo generato e inviato al download."
      : "PDF generato e inviato al download.");
    setStep("Completato.");

    if (skipped.length) log(`Pagine saltate: ${skipped.join(", ")}`);
  } catch (error) {
    log(`ERRORE: ${error?.message || error}`);
    setStep("Errore.");
  } finally {
    $("start").disabled = false;
    $("stop").disabled = true;
  }
});

loadSettings();