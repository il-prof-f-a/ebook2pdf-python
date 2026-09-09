let region = null;
let nextTarget = null;
let stopRequested = false;

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(message) {
  const time = new Date().toLocaleTimeString();
  $("log").textContent += `[${time}] ${message}\n`;
  $("log").scrollTop = $("log").scrollHeight;
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
  if (baselineSharpness == null) {
    return { ok: true, sharpness, reason: `baseline nitidezza ${sharpness.toFixed(2)}` };
  }

  const threshold = baselineSharpness * ratio;
  if (sharpness < threshold) {
    return {
      ok: false,
      type: "blurry",
      sharpness,
      reason: `nitidezza ${sharpness.toFixed(2)} sotto soglia ${threshold.toFixed(2)}`
    };
  }

  return { ok: true, sharpness, reason: `nitidezza ${sharpness.toFixed(2)}` };
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

function buildPdf(pages) {
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
  const chunks = [encode("%PDF-1.4\n%âãÏÓ\n")];
  const offsets = new Array(maxObject + 1).fill(0);
  let cursor = chunks[0].length;

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

async function downloadPdf(pages) {
  const pdf = buildPdf(pages);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await chrome.downloads.download({ url, filename: `ebook2pdf_${stamp}.pdf`, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

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
  log("Arresto richiesto: terminerò dopo il tentativo corrente.");
});

$("start").addEventListener("click", async () => {
  if (!region || !nextTarget) {
    log("Seleziona prima area pagina e comando avanti.");
    return;
  }

  const totalPages = Math.max(1, Number($("pages").value) || 1);
  const delayMs = Math.max(200, (Number($("delay").value) || 1.5) * 1000);
  const maxAttempts = Math.max(1, Number($("attempts").value) || 5);
  const sharpnessRatio = Math.min(1, Math.max(0.1, Number($("sharpness").value) || 0.7));
  const checkDuplicates = $("checkDuplicates").checked;
  const checkQuality = $("checkQuality").checked;

  stopRequested = false;
  $("start").disabled = true;
  $("stop").disabled = false;
  $("progress").max = totalPages;
  $("progress").value = 0;
  $("log").textContent = "";

  const pages = [];
  const skipped = [];
  let previousImageData = null;
  let baselineSharpness = null;

  try {
    for (let pageIndex = 0; pageIndex < totalPages && !stopRequested; pageIndex++) {
      let accepted = null;
      let lastReason = "";

      for (let attempt = 1; attempt <= maxAttempts && !stopRequested; attempt++) {
        if (pageIndex > 0 || attempt > 1) await sleep(attempt === 1 ? delayMs : 1000);

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
          const validation = validateImage(capture.imageData, baselineSharpness, sharpnessRatio);
          lastReason = validation.reason;
          if (!validation.ok) {
            const edgePage = pageIndex === 0 || pageIndex === totalPages - 1;
            if (!(validation.type === "blurry" && edgePage)) {
              log(`Pagina ${pageIndex + 1}, tentativo ${attempt}: ${validation.reason}`);
              continue;
            }
            log(`Pagina ${pageIndex + 1}: accettata pur sgranata perché iniziale/finale.`);
          }
          if (baselineSharpness == null && validation.sharpness != null) {
            baselineSharpness = validation.sharpness;
          }
        }

        accepted = capture;
        break;
      }

      if (accepted) {
        pages.push({ width: accepted.width, height: accepted.height, jpeg: accepted.jpeg });
        previousImageData = accepted.imageData;
        log(`Pagina ${pageIndex + 1}/${totalPages} acquisita.`);
      } else {
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

    if (pages.length) {
      log(`Creo PDF con ${pages.length} pagine...`);
      await downloadPdf(pages);
      log("PDF generato e inviato al download.");
    } else {
      log("Nessuna pagina valida: PDF non creato.");
    }

    if (skipped.length) log(`Pagine saltate: ${skipped.join(", ")}`);
  } catch (error) {
    log(`ERRORE: ${error?.message || error}`);
  } finally {
    $("start").disabled = false;
    $("stop").disabled = true;
  }
});