(() => {
  const DEFAULT_RATIO = 0.50;
  let baselineSharpness = null;

  function normalizeRatio(value) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return DEFAULT_RATIO;
    return Math.min(1, Math.max(0.05, ratio));
  }

  const originalApplySettings = globalThis.applySettings;
  if (typeof originalApplySettings === "function") {
    globalThis.applySettings = function applySettingsWithRatio(settings) {
      const normalized = { ...(settings || {}) };
      normalized.sharpness = normalizeRatio(normalized.sharpness);
      return originalApplySettings(normalized);
    };
  }

  globalThis.validateImage = function validateImageWithRatio(imageData, sharpnessRatio) {
    const halfW = Math.max(1, Math.floor(imageData.width / 2));
    const halfH = Math.max(1, Math.floor(imageData.height / 2));
    const tl = globalThis.quadrantStats(imageData, 0, 0, halfW, halfH);
    const br = globalThis.quadrantStats(
      imageData,
      halfW,
      halfH,
      imageData.width - halfW,
      imageData.height - halfH
    );

    if (tl.range <= 3 || br.range <= 3) {
      return {
        ok: false,
        type: "monochrome",
        reason: "uno dei quadranti è quasi monocolore"
      };
    }

    const sharpness = Math.min(tl.sharpness, br.sharpness);
    const ratio = normalizeRatio(sharpnessRatio);

    if (baselineSharpness == null) {
      baselineSharpness = sharpness;
      return {
        ok: true,
        sharpness,
        baseline: baselineSharpness,
        threshold: baselineSharpness * ratio,
        reason: `baseline nitidezza ${baselineSharpness.toFixed(2)} (ratio ${ratio.toFixed(2)})`
      };
    }

    const threshold = baselineSharpness * ratio;
    if (sharpness < threshold) {
      return {
        ok: false,
        type: "blurry",
        sharpness,
        baseline: baselineSharpness,
        threshold,
        reason: `nitidezza ${sharpness.toFixed(2)} sotto soglia ${threshold.toFixed(2)} (baseline ${baselineSharpness.toFixed(2)} × ratio ${ratio.toFixed(2)})`
      };
    }

    return {
      ok: true,
      sharpness,
      baseline: baselineSharpness,
      threshold,
      reason: `nitidezza ${sharpness.toFixed(2)} (soglia ${threshold.toFixed(2)}, ratio ${ratio.toFixed(2)})`
    };
  };

  const startButton = document.getElementById("start");
  startButton?.addEventListener("click", () => {
    baselineSharpness = null;
  }, true);

  async function migrateLegacySetting() {
    try {
      const key = "ebook2pdfSettings";
      const stored = await chrome.storage.local.get(key);
      const settings = { ...(stored?.[key] || {}) };
      const current = Number(settings.sharpness);

      if (!Number.isFinite(current) || current <= 0 || current > 1) {
        settings.sharpness = DEFAULT_RATIO;
        await chrome.storage.local.set({ [key]: settings });
      }

      const input = document.getElementById("sharpness");
      if (input) input.value = normalizeRatio(settings.sharpness);
    } catch (error) {
      console.warn("Ebook2PDF: impossibile migrare il parametro sharpnessRatio", error);
    }
  }

  const resetButton = document.getElementById("resetSettings");
  resetButton?.addEventListener("click", () => {
    setTimeout(async () => {
      try {
        const key = "ebook2pdfSettings";
        const stored = await chrome.storage.local.get(key);
        const settings = { ...(stored?.[key] || {}), sharpness: DEFAULT_RATIO };
        await chrome.storage.local.set({ [key]: settings });
        const input = document.getElementById("sharpness");
        if (input) input.value = DEFAULT_RATIO;
      } catch (_) {
        // Il reset principale ha già gestito l'eventuale errore di storage.
      }
    }, 0);
  });

  migrateLegacySetting();
})();