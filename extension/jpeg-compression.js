(() => {
  const DEFAULT_JPEG_QUALITY = 75;
  const MIN_JPEG_QUALITY = 50;
  const MAX_JPEG_QUALITY = 100;

  function clampJpegQuality(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_JPEG_QUALITY;
    return Math.round(Math.min(MAX_JPEG_QUALITY, Math.max(MIN_JPEG_QUALITY, numeric)));
  }

  function injectCompressionControl() {
    if (document.getElementById("jpegQuality")) return;

    const duplicateCheck = document.getElementById("checkDuplicates");
    const anchor = duplicateCheck?.closest("label");
    const settingsBox = anchor?.parentElement;
    if (!settingsBox) return;

    const container = document.createElement("div");
    container.className = "jpeg-compression-setting";
    container.innerHTML = `
      <label for="jpegQuality">
        Qualità JPEG / compressione PDF
        <strong id="jpegQualityValue">${DEFAULT_JPEG_QUALITY}%</strong>
      </label>
      <input id="jpegQuality" type="range"
             min="${MIN_JPEG_QUALITY}" max="${MAX_JPEG_QUALITY}"
             step="1" value="${DEFAULT_JPEG_QUALITY}">
      <p class="help">
        <strong>Predefinito: ${DEFAULT_JPEG_QUALITY}%.</strong>
        Riducendo il valore aumenta la compressione e diminuisce il peso del PDF.
        100% mantiene la massima qualità; sotto il 50% la perdita sui caratteri può diventare evidente
        e può ridurre anche l'accuratezza OCR.
      </p>
    `;

    settingsBox.insertBefore(container, anchor);

    const input = document.getElementById("jpegQuality");
    const output = document.getElementById("jpegQualityValue");
    if (input) input.style.width = "100%";

    input?.addEventListener("input", () => {
      const value = clampJpegQuality(input.value);
      if (output) output.textContent = `${value}%`;
    });
  }

  function setControlValue(value) {
    const normalized = clampJpegQuality(value);
    const input = document.getElementById("jpegQuality");
    const output = document.getElementById("jpegQualityValue");
    if (input) input.value = String(normalized);
    if (output) output.textContent = `${normalized}%`;
    return normalized;
  }

  function getControlValue() {
    const input = document.getElementById("jpegQuality");
    return clampJpegQuality(input?.value ?? DEFAULT_JPEG_QUALITY);
  }

  injectCompressionControl();

  const originalNormalizeSettings = normalizeSettings;
  normalizeSettings = function normalizeSettingsWithJpegQuality(settings) {
    const normalized = originalNormalizeSettings(settings);
    normalized.jpegQuality = clampJpegQuality(settings?.jpegQuality);
    return normalized;
  };

  const originalApplySettings = applySettings;
  applySettings = function applySettingsWithJpegQuality(settings) {
    originalApplySettings(settings);
    setControlValue(settings?.jpegQuality ?? DEFAULT_JPEG_QUALITY);
  };

  const originalSettingsFromForm = settingsFromForm;
  settingsFromForm = function settingsFromFormWithJpegQuality() {
    const settings = originalSettingsFromForm();
    settings.jpegQuality = getControlValue();
    return settings;
  };

  chrome.storage.local.get(SETTINGS_KEY).then(stored => {
    const saved = stored?.[SETTINGS_KEY];
    setControlValue(saved?.jpegQuality ?? DEFAULT_JPEG_QUALITY);
  }).catch(() => {
    setControlValue(DEFAULT_JPEG_QUALITY);
  });

  // imageData resta non compresso per il confronto tra frame e la validazione
  // temporale; la compressione riguarda soltanto il JPEG inserito nel PDF.
  cropCapture = async function cropCaptureWithConfigurableJpeg(dataUrl, selection) {
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
    const jpegQuality = getControlValue();
    const jpegBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: jpegQuality / 100
    });
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());

    return { width: sw, height: sh, imageData, jpeg };
  };

  const startButton = document.getElementById("start");
  startButton?.addEventListener("click", () => {
    log(`Compressione PDF: qualità JPEG ${getControlValue()}%.`);
  }, true);
})();
