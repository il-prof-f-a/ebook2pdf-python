from __future__ import annotations

from dataclasses import dataclass
from threading import Event
from time import monotonic
from typing import Callable, Optional

from PIL import Image

from .capture import image_difference
from .settings import AppSettings


@dataclass
class RenderResult:
    image: Optional[Image.Image]
    changed: bool
    timed_out: bool
    stable_comparisons: int
    change_difference: Optional[float]
    frame_difference: Optional[float]


def wait_for_rendered_page(
    capture_fn: Callable[[], Image.Image],
    previous_page: Optional[Image.Image],
    settings: AppSettings,
    stop_event: Event,
    log: Callable[[str], None],
    page_number: int,
    require_change: bool,
) -> RenderResult:
    """Wait until the captured area changes and then becomes visually stable."""

    change_threshold = settings.page_change_threshold_pct / 100.0
    stable_threshold = settings.stability_threshold_pct / 100.0
    deadline = monotonic() + settings.render_max_wait

    changed = not require_change
    last_frame: Optional[Image.Image] = None
    last_capture: Optional[Image.Image] = None
    stable_comparisons = 0
    change_difference: Optional[float] = None
    frame_difference: Optional[float] = None

    if stop_event.wait(settings.min_delay):
        return RenderResult(None, changed, False, 0, None, None)

    while not stop_event.is_set() and monotonic() < deadline:
        capture = capture_fn()
        last_capture = capture

        if require_change and not changed:
            if previous_page is None:
                changed = True
            else:
                change_difference = image_difference(capture, previous_page)
                if change_difference >= change_threshold:
                    changed = True
                    stable_comparisons = 0
                    last_frame = None
                    log(
                        f"Pagina {page_number}: cambio rilevato "
                        f"({change_difference * 100:.3f}%)."
                    )
                else:
                    if stop_event.wait(settings.stability_interval):
                        break
                    continue

        if last_frame is not None:
            frame_difference = image_difference(capture, last_frame)
            if frame_difference <= stable_threshold:
                stable_comparisons += 1
            else:
                stable_comparisons = 0

        last_frame = capture

        if stable_comparisons >= settings.stable_samples:
            log(
                f"Pagina {page_number}: rendering stabile "
                f"({stable_comparisons} conferme, "
                f"Δ {(frame_difference or 0.0) * 100:.3f}%)."
            )
            return RenderResult(
                capture,
                changed,
                False,
                stable_comparisons,
                change_difference,
                frame_difference,
            )

        if stop_event.wait(settings.stability_interval):
            break

    return RenderResult(
        last_capture,
        changed,
        True,
        stable_comparisons,
        change_difference,
        frame_difference,
    )
