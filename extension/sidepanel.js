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
  renderMaxWait: 12,
  stabilityInterval: 0.4,
  stableSamples: 3,
  stabilityThresholdPct: 0.15,
  pageChangeThresholdPct: 0.20,
  useDomSignals: true,
  domIdleMs: 500,
  checkDuplicates: true,
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

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizePsm(value) {
  const psm = String(value ?? DEFAULT_SETTINGS.ocrPsm);
  return ["3", "4", "6", "11"].includes(psm) ? psm : DEFAULT_SETTINGS.ocrPsm;
}

function normalizeOcrScale(value) {
  return clampNumber(value, DEFAULT_SETTINGS.ocrScale, 1, 3);
}

function normalizeSettings(settings) {
  const source = settings || {};
  return {
    delay: clampNumber(source.delay, DEFAULT_SETTINGS.delay, 0.2, 10),
    retryDelay: clampNumber(source.retryDelay, DEFAULT_SETTINGS.retryDelay, 0.5, 20),
    attempts: Math.round(clampNumber(source.attempts, DEFAULT_SETTINGS.attempts, 1, 20)),
    renderMaxWait: clampNumber(source.renderMaxWait, DEFAULT_SETTINGS.renderMaxWait, 2, 60),
    stabilityInterval: clampNumber(source.stabilityInterval, DEFAULT_SETTINGS.stabilityInterval, 0.2, 3),
    stableSamples: Math.round(clampNumber(source.stableSamples, DEFAULT_SETTINGS.stableSamples, 3, 8)),
    stabilityThresholdPct: clampNumber(source.stabilityThresholdPct, DEFAULT_SETTINGS.stabilityThresholdPct, 0.01, 5),
    pageChangeThresholdPct: clampNumber(source.pageChangeThresholdPct, DEFAULT_SETTINGS.pageChangeThresholdPct, 0.01, 10),
    useDomSignals: source.useDomSignals !== false,
    domIdleMs: Math.round(clampNumber(source.domIdleMs, DEFAULT_SETTINGS.domIdleMs, 100, 5000)),
    checkDuplicates: source.checkDuplicates !== false,
    ocrLanguage: ["ita", "eng", "ita+eng"].includes(source.ocrLanguage)
      ? source.ocrLanguage
      : DEFAULT_SETTINGS.ocrLanguage,
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
  $("renderMaxWait").value = merged.renderMaxWait;
  $("stabilityInterval").value = merged.stabilityInterval;
  $("stableSamples").value = merged.stableSamples;
  $("stabilityThresholdPct").value = merged.stabilityThresholdPct;
  $("pageChangeThresholdPct").value = merged.pageChangeThresholdPct;
  $("useDomSignals").checked = merged.useDomSignals;
  $("domIdleMs").value = merged.domIdleMs;
  $("checkDuplicates").checked = merged.checkDuplicates;
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
    renderMaxWait: $("renderMaxWait").value,
    stabilityInterval: $("stabilityInterval").value,
    stableSamples: $("stableSamples").value,
    stabilityThresholdPct: $("stabilityThresholdPct").value,
    pageChangeThresholdPct: $("pageChangeThresholdPct").value,
    useDomSignals: $("useDomSignals").checked,
    domIdleMs: $("domIdleMs").value,
    checkDuplicates: $("checkDuplicates").checked,
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

async function captureRegionNow() {
  return cropCapture(await captureVisible(), region);
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

function domStateSummary(state) {
  if (!state) return "segnali DOM non disponibili";
  const parts = [];
  if (!state.documentReady) parts.push("documento non completo");
  if (!state.fontsReady) parts.push("font in caricamento");
  if (state.busyCount) parts.push(`${state.busyCount} loader/busy`);
  if (state.incompleteImageCount) parts.push(`${state.incompleteImageCount} immagini incomplete`);
  if (!state.domIdle) parts.push(`DOM modificato ${state.mutationIdleMs} ms fa`);
  return parts.length ? parts.join(", ") : "DOM pronto";
}

async function readDomRenderState(settings) {
  if (!settings.useDomSignals) return null;
  try {
    const state = await sendToTab({
      type: "GET_RENDER_STATE",
      region,
      mutationIdleMs: settings.domIdleMs
    });
    return state?.ok ? state : null;
  } catch (error) {
    console.warn("Ebook2PDF: segnali DOM non disponibili", error);
    return null;
  }
}

async function waitForRenderedPage(previousImageData, settings, pageNumber) {
  const requireChange = !!previousImageData && settings.checkDuplicates;
  const changeThreshold = settings.pageChangeThresholdPct / 100;
  const stableThreshold = settings.stabilityThresholdPct / 100;
  const intervalMs = settings.stabilityInterval * 1000;
  const deadline = performance.now() + settings.renderMaxWait * 1000;
  let changed = !requireChange;
  let previousFrame = null;
  let lastCapture = null;
  let lastDomState = null;
  let stableComparisons = 0;
  let changeDifference = null;
  let frameDifference = null;

  await sleep(settings.delay * 1000);

  while (!stopRequested && performance.now() < deadline) {
    const capture = await captureRegionNow();
    lastCapture = capture;

    if (requireChange && !changed) {
      changeDifference = imageDifference(capture.imageData, previousImageData);
      if (changeDifference < changeThreshold) {
        await sleep(intervalMs);
        continue;
      }
      changed = true;
      previousFrame = null;
      stableComparisons = 0;
      log(`Pagina ${pageNumber}: cambio rilevato (${(changeDifference * 100).toFixed(3)}%).`);
    }

    if (previousFrame) {
      frameDifference = imageDifference(capture.imageData, previousFrame.imageData);
      stableComparisons = frameDifference <= stableThreshold ? stableComparisons + 1 : 0;
    }
    previousFrame = capture;

    if (stableComparisons >= settings.stableSamples) {
      lastDomState = await readDomRenderState(settings);
      if (!settings.useDomSignals || !lastDomState || lastDomState.ready) {
        return {
          capture,
          changed,
          timedOut: false,
          stableComparisons,
          frameDifference,
          changeDifference,
          domState: lastDomState
        };
      }
    }

    await sleep(intervalMs);
  }

  if (!lastCapture && !stopRequested) lastCapture = await captureRegionNow();
  return {
    capture: lastCapture,
    changed,
    timedOut: true,
    stableComparisons,
    frameDifference,
    changeDifference,
    domState: lastDomState
  };
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
  if (!globalThis.Ebook2PdfOcr?.recognizePages) throw new Error("Modulo OCR non disponibile.");
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

$("saveSettings").addEventListener("click", saveSettings);

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
  log("Arresto richiesto: termino dopo l'operazione corrente e salvo quanto disponibile.");
});

loadSettings();
