from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from pathlib import Path
import json
import shutil


APP_DIR = Path.home() / ".ebook2pdf"
CONFIG_PATH = APP_DIR / "config.json"


@dataclass
class AppSettings:
    page_count: int = 10
    all_pages: bool = False

    min_delay: float = 1.5
    retry_delay: float = 2.0
    max_attempts: int = 5
    render_max_wait: float = 12.0
    stability_interval: float = 0.6
    stable_samples: int = 3
    stability_threshold_pct: float = 0.15
    page_change_threshold_pct: float = 0.20

    check_duplicates: bool = True

    ocr_enabled: bool = False
    ocr_language: str = "ita+eng"
    ocr_psm: int = 3
    preserve_interword_spaces: bool = True
    ocr_scale: float = 2.0
    tesseract_path: str = ""

    output_dir: str = ""

    def normalized(self) -> "AppSettings":
        languages = {"ita", "eng", "ita+eng"}
        psms = {3, 4, 6, 11}

        self.page_count = max(1, int(self.page_count or 1))
        self.min_delay = _clamp(self.min_delay, 0.0, 10.0, 1.5)
        self.retry_delay = _clamp(self.retry_delay, 0.2, 30.0, 2.0)
        self.max_attempts = max(1, min(20, int(self.max_attempts or 5)))
        self.render_max_wait = _clamp(self.render_max_wait, 2.0, 120.0, 12.0)
        self.stability_interval = _clamp(self.stability_interval, 0.2, 5.0, 0.6)
        self.stable_samples = max(3, min(10, int(self.stable_samples or 3)))
        self.stability_threshold_pct = _clamp(self.stability_threshold_pct, 0.01, 10.0, 0.15)
        self.page_change_threshold_pct = _clamp(self.page_change_threshold_pct, 0.01, 20.0, 0.20)
        self.ocr_language = self.ocr_language if self.ocr_language in languages else "ita+eng"
        try:
            self.ocr_psm = int(self.ocr_psm)
        except (TypeError, ValueError):
            self.ocr_psm = 3
        if self.ocr_psm not in psms:
            self.ocr_psm = 3
        self.ocr_scale = _clamp(self.ocr_scale, 1.0, 3.0, 2.0)
        self.tesseract_path = str(self.tesseract_path or "").strip()
        self.output_dir = str(self.output_dir or "").strip()
        return self


class SettingsStore:
    def __init__(self, path: Path = CONFIG_PATH):
        self.path = path

    def load(self) -> AppSettings:
        if not self.path.exists():
            settings = AppSettings()
            settings.tesseract_path = find_tesseract()
            return settings.normalized()

        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            allowed = {f.name for f in fields(AppSettings)}
            settings = AppSettings(**{k: v for k, v in raw.items() if k in allowed})
        except Exception:
            settings = AppSettings()

        if not settings.tesseract_path:
            settings.tesseract_path = find_tesseract()
        return settings.normalized()

    def save(self, settings: AppSettings) -> None:
        settings.normalized()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(asdict(settings), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )


def find_tesseract() -> str:
    found = shutil.which("tesseract")
    if found:
        return found

    candidates = [
        Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        Path("/usr/bin/tesseract"),
        Path("/usr/local/bin/tesseract"),
        Path("/opt/homebrew/bin/tesseract"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return ""


def _clamp(value, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))
