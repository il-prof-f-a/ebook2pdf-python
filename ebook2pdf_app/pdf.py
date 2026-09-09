from __future__ import annotations

from pathlib import Path
from typing import List, Optional

try:
    import pymupdf as fitz
except ImportError:  # PyMuPDF < 1.24 compatibility
    import fitz  # type: ignore

from .capture import CapturedPage


def write_pdf(
    pages: List[CapturedPage],
    output_path: str,
    ocr_layers: Optional[List[Optional[bytes]]] = None,
) -> int:
    if not pages:
        raise ValueError("Nessuna pagina da salvare.")

    document = fitz.open()
    searchable_pages = 0

    try:
        for index, captured in enumerate(pages):
            max_pt = 842.0
            scale = min(1.0, max_pt / max(captured.width, captured.height))
            width_pt = max(1.0, captured.width * scale)
            height_pt = max(1.0, captured.height * scale)

            page = document.new_page(width=width_pt, height=height_pt)
            page.insert_image(page.rect, stream=captured.jpeg, keep_proportion=False)

            layer = None
            if ocr_layers and index < len(ocr_layers):
                layer = ocr_layers[index]

            if layer:
                ocr_document = None
                try:
                    ocr_document = fitz.open(stream=layer, filetype="pdf")
                    if ocr_document.page_count:
                        page.show_pdf_page(
                            page.rect,
                            ocr_document,
                            0,
                            overlay=True,
                            keep_proportion=False,
                        )
                        searchable_pages += 1
                finally:
                    if ocr_document is not None:
                        ocr_document.close()

        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        document.save(
            str(path),
            garbage=4,
            deflate=True,
            clean=True,
        )
    finally:
        document.close()

    return searchable_pages
