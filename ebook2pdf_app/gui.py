from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from threading import Event, Thread
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import webbrowser

from .capture import (
    CaptureRegion,
    ClickPoint,
    capture_region,
    click_next,
    current_mouse_position,
    diagnostic_quality,
    make_region,
    to_captured_page,
)
from .ocr import ocr_pages, resolve_tesseract, tesseract_version
from .pdf import write_pdf
from .render import wait_for_rendered_page
from .settings import AppSettings, SettingsStore


REPOSITORY_URL = "https://github.com/il-prof-f-a/ebook2pdf-python"


class Ebook2PdfApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Ebook2PDF Desktop")
        self.root.geometry("720x760")
        self.root.minsize(620, 620)

        self.store = SettingsStore()
        self.settings = self.store.load()
        self.events: Queue = Queue()
        self.stop_event = Event()
        self.worker: Thread | None = None

        self.capture_region: CaptureRegion | None = None
        self.next_point: ClickPoint | None = None
        self.selection_busy = False
        self._progress_indeterminate = False

        self._init_variables()
        self._configure_style()
        self._load_icon()
        self._build_ui()
        self._sync_all_pages_state()
        self.root.after(100, self._drain_events)

    def _init_variables(self):
        s = self.settings
        self.page_count_var = tk.StringVar(value=str(s.page_count))
        self.all_pages_var = tk.BooleanVar(value=s.all_pages)
        self.ocr_enabled_var = tk.BooleanVar(value=s.ocr_enabled)
        self.output_path_var = tk.StringVar(value="")

        self.min_delay_var = tk.StringVar(value=str(s.min_delay))
        self.retry_delay_var = tk.StringVar(value=str(s.retry_delay))
        self.max_attempts_var = tk.StringVar(value=str(s.max_attempts))
        self.render_max_wait_var = tk.StringVar(value=str(s.render_max_wait))
        self.stability_interval_var = tk.StringVar(value=str(s.stability_interval))
        self.stable_samples_var = tk.StringVar(value=str(s.stable_samples))
        self.stability_threshold_var = tk.StringVar(value=str(s.stability_threshold_pct))
        self.page_change_threshold_var = tk.StringVar(value=str(s.page_change_threshold_pct))
        self.sharpness_ratio_var = tk.StringVar(value=str(s.sharpness_ratio))
        self.check_duplicates_var = tk.BooleanVar(value=s.check_duplicates)
        self.check_quality_var = tk.BooleanVar(value=s.check_quality)

        self.ocr_language_var = tk.StringVar(value=s.ocr_language)
        self.ocr_psm_var = tk.StringVar(value=str(s.ocr_psm))
        self.preserve_spaces_var = tk.BooleanVar(value=s.preserve_interword_spaces)
        self.ocr_scale_var = tk.StringVar(value=str(s.ocr_scale))
        self.tesseract_path_var = tk.StringVar(value=s.tesseract_path)

        self.region_status_var = tk.StringVar(value="non selezionata")
        self.next_status_var = tk.StringVar(value="non selezionato")
        self.step_var = tk.StringVar(value="Pronto.")
        self.progress_text_var = tk.StringVar(value="Pronto.")
        self.selection_status_var = tk.StringVar(value="")

    def _configure_style(self):
        style = ttk.Style(self.root)
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("Segoe UI", 22, "bold"))
        style.configure("Subtitle.TLabel", foreground="#667085")
        style.configure("Step.TLabel", font=("Segoe UI", 10, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"))

    def _load_icon(self):
        try:
            icon_path = Path(__file__).resolve().parent.parent / "extension" / "icons" / "icon48.png"
            self._icon = tk.PhotoImage(file=str(icon_path))
            self.root.iconphoto(True, self._icon)
        except Exception:
            self._icon = None

    def _build_ui(self):
        container = ttk.Frame(self.root, padding=18)
        container.pack(fill="both", expand=True)

        header = ttk.Frame(container)
        header.pack(fill="x", pady=(0, 14))
        if self._icon is not None:
            ttk.Label(header, image=self._icon).pack(side="left", padx=(0, 10))

        title_box = ttk.Frame(header)
        title_box.pack(side="left", fill="x", expand=True)
        ttk.Label(title_box, text="Ebook2PDF", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            title_box,
            text="Desktop · Capture · PDF · OCR locale",
            style="Subtitle.TLabel",
        ).pack(anchor="w")

        ttk.Button(header, text="⚙ Impostazioni", command=self.open_settings).pack(side="right")

        card = ttk.LabelFrame(container, text="Acquisizione", padding=14)
        card.pack(fill="x")

        page_row = ttk.Frame(card)
        page_row.pack(fill="x", pady=(0, 8))
        ttk.Label(page_row, text="Pagine da acquisire").pack(side="left")
        self.page_count_entry = ttk.Entry(page_row, textvariable=self.page_count_var, width=9)
        self.page_count_entry.pack(side="left", padx=(12, 8))
        ttk.Checkbutton(
            page_row,
            text="Tutte",
            variable=self.all_pages_var,
            command=self._sync_all_pages_state,
        ).pack(side="left")

        buttons = ttk.Frame(card)
        buttons.pack(fill="x", pady=6)
        self.region_button = ttk.Button(
            buttons,
            text="1. Seleziona area pagina",
            command=self.select_region,
        )
        self.region_button.pack(side="left", fill="x", expand=True, padx=(0, 4))
        self.next_button = ttk.Button(
            buttons,
            text="2. Seleziona punto avanti",
            command=self.select_next_point,
        )
        self.next_button.pack(side="left", fill="x", expand=True, padx=(4, 0))

        status = ttk.Frame(card)
        status.pack(fill="x", pady=(8, 4))
        ttk.Label(status, text="Area:").grid(row=0, column=0, sticky="w")
        ttk.Label(status, textvariable=self.region_status_var).grid(row=0, column=1, sticky="w", padx=(6, 20))
        ttk.Label(status, text="Avanti:").grid(row=0, column=2, sticky="w")
        ttk.Label(status, textvariable=self.next_status_var).grid(row=0, column=3, sticky="w", padx=(6, 0))
        status.columnconfigure(1, weight=1)
        status.columnconfigure(3, weight=1)

        ttk.Label(
            card,
            textvariable=self.selection_status_var,
            foreground="#9a6700",
        ).pack(anchor="w", pady=(2, 4))

        ttk.Checkbutton(
            card,
            text="Crea PDF ricercabile con OCR locale Tesseract",
            variable=self.ocr_enabled_var,
        ).pack(anchor="w", pady=(8, 4))

        output_row = ttk.Frame(card)
        output_row.pack(fill="x", pady=(6, 2))
        ttk.Label(output_row, text="PDF:").pack(side="left")
        ttk.Entry(output_row, textvariable=self.output_path_var).pack(
            side="left", fill="x", expand=True, padx=8
        )
        ttk.Button(output_row, text="Scegli…", command=self.choose_output).pack(side="right")

        action_row = ttk.Frame(container)
        action_row.pack(fill="x", pady=14)
        self.start_button = ttk.Button(
            action_row,
            text="▶ Avvia acquisizione",
            style="Primary.TButton",
            command=self.start,
        )
        self.start_button.pack(side="left", fill="x", expand=True, padx=(0, 5))
        self.stop_button = ttk.Button(
            action_row,
            text="■ Ferma",
            command=self.stop,
            state="disabled",
        )
        self.stop_button.pack(side="left", fill="x", expand=True, padx=(5, 0))

        ttk.Label(container, textvariable=self.step_var, style="Step.TLabel").pack(anchor="w")
        self.progress = ttk.Progressbar(container, mode="determinate", maximum=1, value=0)
        self.progress.pack(fill="x", pady=(6, 3))
        ttk.Label(container, textvariable=self.progress_text_var).pack(anchor="w")

        log_frame = ttk.LabelFrame(container, text="Log", padding=8)
        log_frame.pack(fill="both", expand=True, pady=(12, 8))
        self.log_text = tk.Text(
            log_frame,
            height=16,
            wrap="word",
            bg="#0d1117",
            fg="#c9d1d9",
            insertbackground="#ffffff",
            relief="flat",
            font=("Consolas", 9),
        )
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        scrollbar.pack(side="right", fill="y")
        self.log_text.configure(yscrollcommand=scrollbar.set, state="disabled")

        footer = ttk.Frame(container)
        footer.pack(fill="x", pady=(2, 0))
        ttk.Label(footer, text="Prof. Adriani · ").pack(side="left")
        repo = ttk.Label(footer, text="GitHub repository", foreground="#0969da", cursor="hand2")
        repo.pack(side="left")
        repo.bind("<Button-1>", lambda _event: webbrowser.open(REPOSITORY_URL))

    def _sync_all_pages_state(self):
        self.page_count_entry.configure(state="disabled" if self.all_pages_var.get() else "normal")

    def choose_output(self):
        settings = self._settings_from_vars()
        initial_dir = settings.output_dir or str(Path.home())
        suffix = "_ocr" if self.ocr_enabled_var.get() else ""
        default_name = f"ebook2pdf_{datetime.now():%Y%m%d_%H%M%S}{suffix}.pdf"
        path = filedialog.asksaveasfilename(
            title="Salva PDF",
            initialdir=initial_dir,
            initialfile=default_name,
            defaultextension=".pdf",
            filetypes=[("PDF", "*.pdf")],
        )
        if path:
            self.output_path_var.set(path)

    def select_region(self):
        if self.selection_busy:
            return
        self._log_ui("Selezione area: tra 3 secondi registro l'angolo superiore sinistro.")

        def first_ready(first: ClickPoint):
            self._log_ui(f"Angolo superiore sinistro: ({first.x}, {first.y}).")
            self._countdown_point(
                "Posiziona ora il mouse sull'angolo INFERIORE DESTRO",
                lambda second: self._finish_region(first, second),
            )

        self._countdown_point(
            "Posiziona il mouse sull'angolo SUPERIORE SINISTRO",
            first_ready,
        )

    def _finish_region(self, first: ClickPoint, second: ClickPoint):
        try:
            self.capture_region = make_region(first, second)
        except ValueError as exc:
            messagebox.showerror("Ebook2PDF", str(exc))
            return
        region = self.capture_region
        self.region_status_var.set(
            f"{region.width}×{region.height} @ ({region.left},{region.top})"
        )
        self.selection_status_var.set("")
        self._log_ui(f"Area pagina selezionata: {region.width}×{region.height} px.")

    def select_next_point(self):
        if self.selection_busy:
            return

        def ready(point: ClickPoint):
            self.next_point = point
            self.next_status_var.set(f"({point.x}, {point.y})")
            self.selection_status_var.set("")
            self._log_ui(f"Punto pagina successiva selezionato: ({point.x}, {point.y}).")

        self._countdown_point(
            "Posiziona il mouse sul comando PAGINA SUCCESSIVA",
            ready,
        )

    def _countdown_point(self, prompt: str, callback, seconds: int = 3):
        if self.selection_busy:
            return
        self.selection_busy = True

        def tick(remaining: int):
            if remaining > 0:
                self.selection_status_var.set(f"{prompt} — acquisizione tra {remaining}…")
                self.root.after(1000, lambda: tick(remaining - 1))
                return

            point = current_mouse_position()
            self.selection_busy = False
            callback(point)

        tick(seconds)

    def open_settings(self):
        window = tk.Toplevel(self.root)
        window.title("Ebook2PDF · Impostazioni")
        window.geometry("650x650")
        window.transient(self.root)

        notebook = ttk.Notebook(window)
        notebook.pack(fill="both", expand=True, padx=12, pady=12)
        capture_tab = ttk.Frame(notebook, padding=14)
        ocr_tab = ttk.Frame(notebook, padding=14)
        notebook.add(capture_tab, text="Acquisizione")
        notebook.add(ocr_tab, text="OCR")

        row = 0
        row = self._setting_entry(capture_tab, row, "Attesa minima dopo cambio pagina (s)", self.min_delay_var)
        row = self._setting_entry(capture_tab, row, "Tempo massimo attesa rendering (s)", self.render_max_wait_var)
        row = self._setting_entry(capture_tab, row, "Intervallo controllo stabilità (s)", self.stability_interval_var)
        row = self._setting_entry(capture_tab, row, "Conferme visive consecutive", self.stable_samples_var)
        row = self._setting_entry(capture_tab, row, "Soglia stabilità visiva (%)", self.stability_threshold_var)
        row = self._setting_entry(capture_tab, row, "Soglia cambio pagina (%)", self.page_change_threshold_var)
        row = self._setting_entry(capture_tab, row, "Attesa tra retry click (s)", self.retry_delay_var)
        row = self._setting_entry(capture_tab, row, "Tentativi massimi cambio pagina", self.max_attempts_var)
        row = self._setting_entry(capture_tab, row, "Ratio nitidezza diagnostica", self.sharpness_ratio_var)
        ttk.Checkbutton(
            capture_tab,
            text="Verifica che la pagina sia realmente cambiata",
            variable=self.check_duplicates_var,
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=5)
        row += 1
        ttk.Checkbutton(
            capture_tab,
            text="Misura nitidezza a scopo diagnostico",
            variable=self.check_quality_var,
        ).grid(row=row, column=0, columnspan=2, sticky="w", pady=5)
        capture_tab.columnconfigure(1, weight=1)

        ttk.Label(ocr_tab, text="Lingua OCR").grid(row=0, column=0, sticky="w", pady=6)
        ttk.Combobox(
            ocr_tab,
            textvariable=self.ocr_language_var,
            values=("ita+eng", "ita", "eng"),
            state="readonly",
        ).grid(row=0, column=1, sticky="ew", pady=6)

        ttk.Label(ocr_tab, text="Segmentazione Tesseract (PSM)").grid(row=1, column=0, sticky="w", pady=6)
        ttk.Combobox(
            ocr_tab,
            textvariable=self.ocr_psm_var,
            values=("3", "4", "6", "11"),
            state="readonly",
        ).grid(row=1, column=1, sticky="ew", pady=6)

        ttk.Label(ocr_tab, text="Upscale OCR").grid(row=2, column=0, sticky="w", pady=6)
        ttk.Combobox(
            ocr_tab,
            textvariable=self.ocr_scale_var,
            values=("1", "1.5", "2", "2.5", "3"),
            state="readonly",
        ).grid(row=2, column=1, sticky="ew", pady=6)

        ttk.Checkbutton(
            ocr_tab,
            text="Preserva gli spazi tra le parole",
            variable=self.preserve_spaces_var,
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=8)

        ttk.Label(ocr_tab, text="Tesseract executable").grid(row=4, column=0, sticky="w", pady=6)
        tess_row = ttk.Frame(ocr_tab)
        tess_row.grid(row=4, column=1, sticky="ew", pady=6)
        ttk.Entry(tess_row, textvariable=self.tesseract_path_var).pack(side="left", fill="x", expand=True)
        ttk.Button(tess_row, text="…", width=3, command=self._browse_tesseract).pack(side="left", padx=(5, 0))

        ttk.Button(ocr_tab, text="Test Tesseract", command=self._test_tesseract).grid(
            row=5, column=1, sticky="e", pady=8
        )
        ttk.Label(
            ocr_tab,
            text=(
                "Tesseract viene eseguito localmente. Per preservare la geometria del PDF, "
                "l'immagine OCR viene ingrandita ma il DPI viene compensato."
            ),
            wraplength=560,
            foreground="#667085",
        ).grid(row=6, column=0, columnspan=2, sticky="w", pady=12)
        ocr_tab.columnconfigure(1, weight=1)

        buttons = ttk.Frame(window, padding=(12, 0, 12, 12))
        buttons.pack(fill="x")
        ttk.Button(buttons, text="Salva", command=lambda: self._save_settings_window(window)).pack(side="right")
        ttk.Button(buttons, text="Chiudi", command=window.destroy).pack(side="right", padx=(0, 8))

    def _setting_entry(self, parent, row: int, label: str, variable) -> int:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=5)
        ttk.Entry(parent, textvariable=variable, width=16).grid(row=row, column=1, sticky="ew", pady=5)
        return row + 1

    def _browse_tesseract(self):
        path = filedialog.askopenfilename(title="Seleziona tesseract executable")
        if path:
            self.tesseract_path_var.set(path)

    def _test_tesseract(self):
        try:
            settings = self._settings_from_vars()
            executable = resolve_tesseract(settings)
            messagebox.showinfo("Tesseract", tesseract_version(executable))
        except Exception as exc:
            messagebox.showerror("Tesseract", str(exc))

    def _save_settings_window(self, window):
        try:
            settings = self._settings_from_vars()
            self.store.save(settings)
            self.settings = settings
            window.destroy()
            self._log_ui("Impostazioni salvate.")
        except Exception as exc:
            messagebox.showerror("Impostazioni", str(exc))

    def _settings_from_vars(self) -> AppSettings:
        settings = AppSettings(
            page_count=_int(self.page_count_var.get(), 10),
            all_pages=self.all_pages_var.get(),
            min_delay=_float(self.min_delay_var.get(), 1.5),
            retry_delay=_float(self.retry_delay_var.get(), 2.0),
            max_attempts=_int(self.max_attempts_var.get(), 5),
            render_max_wait=_float(self.render_max_wait_var.get(), 12.0),
            stability_interval=_float(self.stability_interval_var.get(), 0.6),
            stable_samples=_int(self.stable_samples_var.get(), 2),
            stability_threshold_pct=_float(self.stability_threshold_var.get(), 0.15),
            page_change_threshold_pct=_float(self.page_change_threshold_var.get(), 0.20),
            sharpness_ratio=_float(self.sharpness_ratio_var.get(), 0.50),
            check_duplicates=self.check_duplicates_var.get(),
            check_quality=self.check_quality_var.get(),
            ocr_enabled=self.ocr_enabled_var.get(),
            ocr_language=self.ocr_language_var.get(),
            ocr_psm=_int(self.ocr_psm_var.get(), 3),
            preserve_interword_spaces=self.preserve_spaces_var.get(),
            ocr_scale=_float(self.ocr_scale_var.get(), 2.0),
            tesseract_path=self.tesseract_path_var.get(),
            output_dir=self.settings.output_dir,
        )
        return settings.normalized()

    def start(self):
        if self.worker and self.worker.is_alive():
            return
        if self.capture_region is None:
            messagebox.showwarning("Ebook2PDF", "Seleziona prima l'area della pagina.")
            return
        if self.next_point is None:
            messagebox.showwarning("Ebook2PDF", "Seleziona prima il punto pagina successiva.")
            return

        settings = self._settings_from_vars()
        output_path = self.output_path_var.get().strip()
        if not output_path:
            self.choose_output()
            output_path = self.output_path_var.get().strip()
            if not output_path:
                return
        if not output_path.lower().endswith(".pdf"):
            output_path += ".pdf"
            self.output_path_var.set(output_path)

        settings.output_dir = str(Path(output_path).parent)
        self.store.save(settings)
        self.settings = settings

        self.stop_event.clear()
        self._set_running(True)
        self._clear_log()
        self.step_var.set("1/3 — Acquisizione" if settings.ocr_enabled else "1/2 — Acquisizione")
        self._set_progress(0, None if settings.all_pages else settings.page_count)

        region = self.capture_region
        point = self.next_point
        self.worker = Thread(
            target=self._worker_run,
            args=(settings, region, point, output_path),
            daemon=True,
        )
        self.worker.start()

    def stop(self):
        if self.worker and self.worker.is_alive():
            self.stop_event.set()
            self._log_ui("Arresto richiesto: termino l'operazione corrente e salvo quanto già acquisito.")

    def _worker_run(
        self,
        settings: AppSettings,
        region: CaptureRegion,
        point: ClickPoint,
        output_path: str,
    ):
        pages = []
        previous_image = None
        baseline_sharpness = None
        page_number = 1

        log = lambda message: self.events.put(("log", message))
        progress = lambda current, total: self.events.put(("progress", current, total))

        try:
            if settings.all_pages:
                log("Modalità Tutte: continuo finché i click non producono più un cambio pagina.")
            log(
                f"Rendering: max {settings.render_max_wait:.1f}s, intervallo "
                f"{settings.stability_interval:.1f}s, {settings.stable_samples} conferme, "
                f"cambio minimo {settings.page_change_threshold_pct:.2f}%."
            )
            if settings.check_quality:
                log(
                    f"Nitidezza diagnostica: ratio {settings.sharpness_ratio:.2f}; "
                    "non causa lo scarto della pagina."
                )

            while not self.stop_event.is_set():
                if not settings.all_pages and page_number > settings.page_count:
                    break

                if page_number == 1:
                    result = wait_for_rendered_page(
                        lambda: capture_region(region),
                        None,
                        settings,
                        self.stop_event,
                        log,
                        page_number,
                        require_change=False,
                    )
                else:
                    require_change = settings.all_pages or settings.check_duplicates
                    result = None
                    changed = False

                    for attempt in range(1, settings.max_attempts + 1):
                        if self.stop_event.is_set():
                            break
                        click_next(point)
                        log(
                            f"Pagina {page_number}: cambio pagina, tentativo "
                            f"{attempt}/{settings.max_attempts}."
                        )
                        result = wait_for_rendered_page(
                            lambda: capture_region(region),
                            previous_image,
                            settings,
                            self.stop_event,
                            log,
                            page_number,
                            require_change=require_change,
                        )

                        if not require_change or result.changed:
                            changed = True
                            break

                        diff = (result.change_difference or 0.0) * 100
                        log(
                            f"Pagina {page_number}: contenuto non cambiato abbastanza "
                            f"(Δ {diff:.3f}%)."
                        )
                        if attempt < settings.max_attempts and self.stop_event.wait(settings.retry_delay):
                            break

                    if self.stop_event.is_set():
                        break

                    if require_change and not changed:
                        if settings.all_pages:
                            log(
                                f"Fine documento rilevata dopo {len(pages)} pagine: "
                                "il comando avanti non produce più cambiamenti."
                            )
                        else:
                            log(
                                f"Pagina {page_number}: cambio pagina non rilevato. "
                                "Interrompo l'acquisizione senza creare duplicati."
                            )
                        break

                if self.stop_event.is_set():
                    break
                if result is None or result.image is None:
                    raise RuntimeError(f"Impossibile acquisire la pagina {page_number}.")

                if result.timed_out:
                    log(
                        f"Pagina {page_number}: timeout rendering; acquisisco comunque "
                        "l'ultimo frame disponibile."
                    )

                image = result.image
                if settings.check_quality:
                    quality = diagnostic_quality(
                        image,
                        baseline_sharpness,
                        settings.sharpness_ratio,
                    )
                    if baseline_sharpness is None and quality.sharpness is not None:
                        baseline_sharpness = quality.sharpness
                        log(f"Baseline nitidezza impostata a {baseline_sharpness:.2f}.")
                    if not quality.ok:
                        log(
                            f"Pagina {page_number}: AVVISO qualità — {quality.reason}. "
                            "La pagina viene comunque acquisita."
                        )

                pages.append(to_captured_page(image))
                previous_image = image
                log(
                    f"Pagina {page_number}"
                    + ("" if settings.all_pages else f"/{settings.page_count}")
                    + " acquisita."
                )
                progress(len(pages), None if settings.all_pages else settings.page_count)
                page_number += 1

            if not pages:
                raise RuntimeError("Nessuna pagina acquisita; PDF non creato.")

            layers = None
            if settings.ocr_enabled and not self.stop_event.is_set():
                self.events.put(("step", "2/3 — OCR locale"))
                log(
                    f"Avvio OCR su {len(pages)} pagine "
                    f"({settings.ocr_language}, PSM {settings.ocr_psm}, "
                    f"upscale {settings.ocr_scale:.1f}×)."
                )

                def ocr_progress(current, total, status):
                    self.events.put(("ocr_progress", current, total, status))

                try:
                    layers = ocr_pages(
                        pages,
                        settings,
                        self.stop_event,
                        ocr_progress,
                        log,
                    )
                    if self.stop_event.is_set():
                        layers = None
                        log("OCR interrotto: creo il PDF normale con le pagine acquisite.")
                    else:
                        completed = sum(1 for layer in layers if layer)
                        log(f"OCR completato su {completed}/{len(pages)} pagine.")
                except Exception as exc:
                    layers = None
                    log(f"ERRORE OCR: {exc}")
                    log("Creo comunque il PDF acquisito senza layer OCR.")
            elif settings.ocr_enabled and self.stop_event.is_set():
                log("OCR saltato perché è stato richiesto l'arresto.")

            self.events.put((
                "step",
                "3/3 — Creazione PDF" if settings.ocr_enabled else "2/2 — Creazione PDF",
            ))
            searchable_pages = write_pdf(pages, output_path, layers)
            if searchable_pages:
                log(
                    f"PDF creato: {searchable_pages}/{len(pages)} pagine con layer OCR Tesseract."
                )
            else:
                log(f"PDF creato con {len(pages)} pagine.")
            self.events.put(("done", output_path, len(pages), searchable_pages))

        except Exception as exc:
            self.events.put(("error", str(exc)))

    def _set_running(self, running: bool):
        state = "disabled" if running else "normal"
        self.start_button.configure(state=state)
        self.region_button.configure(state=state)
        self.next_button.configure(state=state)
        self.stop_button.configure(state="normal" if running else "disabled")

    def _drain_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "log":
                    self._log_ui(event[1])
                elif kind == "progress":
                    self._set_progress(event[1], event[2])
                elif kind == "ocr_progress":
                    current, total, status = event[1], event[2], event[3]
                    self._set_progress(current - 1, total)
                    self.progress_text_var.set(f"OCR pagina {current}/{total} — {status}")
                elif kind == "step":
                    self.step_var.set(event[1])
                elif kind == "done":
                    self._set_running(False)
                    self._stop_indeterminate_progress()
                    path, pages, searchable = event[1], event[2], event[3]
                    self.step_var.set("Completato.")
                    self.progress_text_var.set(
                        f"{pages} pagine salvate; {searchable} con OCR."
                        if searchable
                        else f"{pages} pagine salvate."
                    )
                    messagebox.showinfo("Ebook2PDF", f"PDF creato:\n{path}")
                elif kind == "error":
                    self._set_running(False)
                    self._stop_indeterminate_progress()
                    self.step_var.set("Errore.")
                    self._log_ui(f"ERRORE: {event[1]}")
                    messagebox.showerror("Ebook2PDF", event[1])
        except Empty:
            pass
        finally:
            self.root.after(100, self._drain_events)

    def _set_progress(self, current: int, total: int | None):
        if total is None:
            if not self._progress_indeterminate:
                self.progress.configure(mode="indeterminate")
                self.progress.start(12)
                self._progress_indeterminate = True
            self.progress_text_var.set(f"{current} pagine acquisite")
            return

        self._stop_indeterminate_progress()
        self.progress.configure(mode="determinate", maximum=max(1, total), value=current)
        self.progress_text_var.set(f"{current}/{total}")

    def _stop_indeterminate_progress(self):
        if self._progress_indeterminate:
            self.progress.stop()
            self.progress.configure(mode="determinate")
            self._progress_indeterminate = False

    def _clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _log_ui(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}] {message}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")


def _float(value, fallback: float) -> float:
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return fallback


def _int(value, fallback: int) -> int:
    try:
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return fallback


def main():
    root = tk.Tk()
    Ebook2PdfApp(root)
    root.mainloop()
