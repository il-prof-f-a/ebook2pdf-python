(() => {
  const MIN_JPEG_QUALITY = 50;
  const MAX_JPEG_QUALITY = 100;

  function clampJpegQuality(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.jpegQuality;
    return Math.round(Math.min(MAX_JPEG_QUALITY, Math.max(MIN_JPEG_QUALITY, numeric)));
  }

  function getControlValue() {
    return clampJpegQuality(document.getElementById("jpegQuality")?.value);
  }

  const input = document.getElementById("jpegQuality");
  const output = document.getElementById("jpegQualityValue");
  input?.addEventListener("input", () => {
    const value = getControlValue();
    if (output) output.textContent = `${value}%`;
  });

  // imageData resta non compresso per cambio pagina e convergenza temporale;
  // la qualità configurabile riguarda soltanto il JPEG inserito nel PDF.
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
    const jpegBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: getControlValue() / 100
    });
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());

    return { width: sw, height: sh, imageData, jpeg };
  };

  const startButton = document.getElementById("start");
  startButton?.addEventListener("click", () => {
    log(`Compressione PDF: qualità JPEG ${getControlValue()}%.`);
  }, true);
})();
