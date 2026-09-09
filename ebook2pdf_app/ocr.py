from __future__ import annotations

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from typing import Callable, List, Optional
import os
import subprocess

from PIL import Image

from .capture import CapturedPage
from .settings import AppSettings, find_tesseract


ProgressCallback = Callable[[int, int, str], None]
LogCallback = Callable[[str], None]


def resolve_tesseract(settings: AppSettings) -> str:
    configured = str(settings.tesseract_path or "").strip()
    if configured and Path(configured).exists():
        return configured
    found = find_tesseract()
    if found:
        return found
    raise RuntimeError(
        "Tesseract OCR non trovato. Installalo e indica il percorso nelle impostazioni."
    )


def tesseract_version(executable: str) -> str:
    result = _run([executable, "--version"])
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Impossibile eseguire Tesseract.")
    return (result.stdout.splitlines() or ["Tesseract"])[0].strip()


def ocr_pages(
    pages: List[CapturedPage],
    settings: AppSettings,
    stop_event: Event,
    progress: ProgressCallback,
    log: LogCallback,
) -> List[Optional[bytes]]:
    executable = resolve_tesseract(settings)
    log(f"OCR locale: {tesseract_version(executable)}")

    layers: List[Optional[bytes]] = []
    total = len(pages)

    with TemporaryDirectory(prefix="ebook2pdf_ocr_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)

        for index, page in enumerate(pages, start=1):
            if stop_event.is_set():
                break

            progress(index, total, "preparazione immagine")
            try:
                layer = _ocr_single_page(
                    page,
                    settings,
                    executable,
                    temp_dir,
                    index,
                    progress,
                    total,
                )
                layers.append(layer)
                log(f"OCR pagina {index}/{total} completato.")
            except Exception as exc:
                layers.append(None)
                log(f"AVVISO OCR pagina {index}/{total}: {exc}")

    while len(layers) < total:
        layers.append(None)
    return layers


def _ocr_single_page(
    page: CapturedPage,
    settings: AppSettings,
    executable: str,
    temp_dir: Path,
    index: int,
    progress: ProgressCallback,
    total: int,
) -> bytes:
    input_path = temp_dir / f"page_{index:05d}.png"
    output_base = temp_dir / f"page_{index:05d}_ocr"
    output_pdf = output_base.with_suffix(".pdf")

    with Image.open(BytesIO(page.jpeg)) as source:
        image = source.convert("RGB")
        scale = float(settings.ocr_scale)
        if scale != 1.0:
            width = max(1, round(image.width * scale))
            height = max(1, round(image.height * scale))
            image = image.resize((width, height), Image.Resampling.LANCZOS)

        dpi = max(72, round(72 * scale))
        image.save(input_path, format="PNG", dpi=(dpi, dpi))

    progress(index, total, "Tesseract")
    command = [
        executable,
        str(input_path),
        str(output_base),
        "-l",
        settings.ocr_language,
        "--psm",
        str(settings.ocr_psm),
        "--dpi",
        str(max(72, round(72 * float(settings.ocr_scale)))),
        "-c",
        f"preserve_interword_spaces={1 if settings.preserve_interword_spaces else 0}",
        "-c",
        "textonly_pdf=1",
        "pdf",
    ]

    result = _run(command)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "errore Tesseract"
        raise RuntimeError(message)
    if not output_pdf.exists():
        raise RuntimeError("Tesseract non ha generato il PDF text-only.")

    return output_pdf.read_bytes()


def _run(command):
    creationflags = 0
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        creationflags = subprocess.CREATE_NO_WINDOW
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        creationflags=creationflags,
    )
