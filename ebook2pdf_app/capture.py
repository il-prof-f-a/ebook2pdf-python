from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Tuple

import numpy as np
import pyautogui
from PIL import Image, ImageGrab


@dataclass(frozen=True)
class CaptureRegion:
    left: int
    top: int
    width: int
    height: int

    @property
    def bbox(self) -> Tuple[int, int, int, int]:
        return (
            self.left,
            self.top,
            self.left + self.width,
            self.top + self.height,
        )


@dataclass(frozen=True)
class ClickPoint:
    x: int
    y: int


@dataclass
class CapturedPage:
    width: int
    height: int
    jpeg: bytes


def capture_region(region: CaptureRegion) -> Image.Image:
    try:
        image = ImageGrab.grab(bbox=region.bbox, all_screens=True)
    except TypeError:
        image = ImageGrab.grab(bbox=region.bbox)
    return image.convert("RGB")


def click_next(point: ClickPoint) -> None:
    pyautogui.click(point.x, point.y)


def current_mouse_position() -> ClickPoint:
    pos = pyautogui.position()
    return ClickPoint(int(pos.x), int(pos.y))


def make_region(first: ClickPoint, second: ClickPoint) -> CaptureRegion:
    left = min(first.x, second.x)
    top = min(first.y, second.y)
    width = abs(second.x - first.x)
    height = abs(second.y - first.y)
    if width < 10 or height < 10:
        raise ValueError("L'area selezionata è troppo piccola.")
    return CaptureRegion(left, top, width, height)


def to_captured_page(image: Image.Image, quality: int = 90) -> CapturedPage:
    out = BytesIO()
    image.convert("RGB").save(out, format="JPEG", quality=quality, optimize=True)
    return CapturedPage(image.width, image.height, out.getvalue())


def image_difference(first: Image.Image, second: Image.Image, step: int = 4) -> float:
    if first.size != second.size:
        return 1.0

    a = np.asarray(first.convert("RGB"), dtype=np.int16)[::step, ::step]
    b = np.asarray(second.convert("RGB"), dtype=np.int16)[::step, ::step]
    if a.size == 0:
        return 1.0
    return float(np.abs(a - b).mean() / 255.0)
