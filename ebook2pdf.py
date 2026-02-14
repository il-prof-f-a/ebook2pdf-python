import time
import os
from datetime import datetime

import pyautogui as pag
from PIL import Image, ImageChops, ImageGrab
import numpy as np


# ==========================
#  Funzioni di utilità
# ==========================

def ask_int(prompt, min_value=1):
    while True:
        try:
            val = int(input(prompt + f" (>= {min_value}): "))
            if val < min_value:
                raise ValueError
            return val
        except ValueError:
            print(f"Valore non valido, inserisci un intero >= {min_value}.")


def ask_float(prompt, min_value=0.0):
    while True:
        try:
            val = float(input(prompt + f" (>= {min_value}): ").replace(",", "."))
            if val < min_value:
                raise ValueError
            return val
        except ValueError:
            print(f"Valore non valido, inserisci un numero >= {min_value}.")


def ask_output_path():
    default_name = f"cattura_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    path = input(
        f"Percorso completo file PDF in uscita "
        f"(INVIO per usare '{default_name}' nella cartella corrente): "
    ).strip()
    if not path:
        path = os.path.join(os.getcwd(), default_name)

    folder = os.path.dirname(path)
    if folder and not os.path.exists(folder):
        print(f"La cartella '{folder}' non esiste, la creo...")
        os.makedirs(folder, exist_ok=True)

    if not path.lower().endswith(".pdf"):
        path += ".pdf"

    return path


def wait_for_mouse_position(msg):
    print()
    print(msg)
    print(" -> Posiziona il mouse nel punto desiderato e premi INVIO nella console.")
    input("Premi INVIO quando sei pronto...")
    x, y = pag.position()
    print(f"   Coordinate registrate: ({x}, {y})")
    return x, y


def choose_capture_region():
    print("\n--- DEFINIZIONE AREA DI CATTURA ---")
    x1, y1 = wait_for_mouse_position("Angolo SUPERIORE SINISTRO dell'area da catturare")
    x2, y2 = wait_for_mouse_position("Angolo INFERIORE DESTRO dell'area da catturare")

    left = min(x1, x2)
    top = min(y1, y2)
    width = abs(x2 - x1)
    height = abs(y2 - y1)

    print(f"\nArea selezionata: left={left}, top={top}, width={width}, height={height}")
    conferma = input("Confermi? (s/N): ").strip().lower()
    if conferma != "s":
        print("Rifacciamo la selezione dell'area.")
        return choose_capture_region()

    return (left, top, width, height)


# ==========================
#  Controlli qualità immagine
# ==========================

def get_corner_quadrants(img):
    """
    Ritorna due quadrati di verifica da 1/4 dell'immagine:
    - quadrante in alto a sinistra
    - quadrante in basso a destra
    """
    w, h = img.size
    tl = img.crop((0, 0, w // 2, h // 2))          # top-left
    br = img.crop((w // 2, h // 2, w, h))          # bottom-right
    return tl, br


def is_monochrome(img, tolerance=0):
    """
    Ritorna True se l'immagine è praticamente monocolore.
    """
    gray = img.convert("L")
    arr = np.array(gray)
    min_val = arr.min()
    max_val = arr.max()
    return (max_val - min_val) <= tolerance


def image_sharpness(img):
    """
    Stima molto semplice della nitidezza usando il gradiente.
    Più è alto il valore, più l'immagine contiene dettagli.
    """
    gray = img.convert("L")
    arr = np.array(gray, dtype=np.float32)
    gy, gx = np.gradient(arr)
    gnorm = np.sqrt(gx ** 2 + gy ** 2)
    return float(gnorm.mean())


def is_same_as_previous(img, prev_img):
    """
    True se l'immagine è identica (o quasi) alla precedente.
    """
    if prev_img is None:
        return False
    if img.size != prev_img.size:
        return False
    diff = ImageChops.difference(img, prev_img)
    bbox = diff.getbbox()
    return bbox is None


def validate_image(img, baseline_sharpness, sharpness_min_ratio=0.7):
    """
    Valida l'immagine controllando DUE riquadri di verifica,
    ciascuno grande w = W/2, h = H/2 (quindi 1/4 dell'area totale):

      - uno in ALTO SINISTRA
      - uno in BASSO DESTRA

    Entrambi devono:
      - NON essere monocolore
      - NON essere troppo sgranati rispetto al baseline

    Ritorna (ok: bool, reason: str, new_sharpness: float, failure_type: str|None)
    failure_type può essere:
      - None
      - "monochrome"
      - "blurry"
    """
    tl, br = get_corner_quadrants(img)

    # Se uno dei due riquadri è monocolore, la pagina non è pronta
    if is_monochrome(tl) or is_monochrome(br):
        return (
            False,
            "Almeno uno dei riquadri (alto-sx / basso-dx) è monocolore (pagina non caricata?).",
            None,
            "monochrome",
        )

    # Calcolo nitidezza su entrambi
    sharp_tl = image_sharpness(tl)
    sharp_br = image_sharpness(br)

    # Usiamo la nitidezza peggiore dei due: deve essere sopra soglia in ENTRAMBI
    combined_sharp = min(sharp_tl, sharp_br)

    if baseline_sharpness is None:
        reason = (
            "OK (prima pagina, definisco baseline nitidezza: "
            f"tl={sharp_tl:.2f}, br={sharp_br:.2f}, min={combined_sharp:.2f})."
        )
        return True, reason, combined_sharp, None

    soglia = baseline_sharpness * sharpness_min_ratio
    if combined_sharp < soglia:
        reason = (
            "Riquadri troppo sgranati: "
            f"sharp_tl={sharp_tl:.2f}, sharp_br={sharp_br:.2f}, "
            f"min={combined_sharp:.2f}, soglia={soglia:.2f}"
        )
        return False, reason, combined_sharp, "blurry"

    return True, "OK (entrambi i riquadri sufficientemente nitidi).", combined_sharp, None


# ==========================
#  Ciclo di acquisizione
# ==========================

def acquire_pages(num_pages, min_delay, max_attempts, capture_region, next_x, next_y,
                  images, prev_page_img, baseline_sharp):
    """
    Acquisisce num_pages pagine. Ritorna (images, prev_page_img, baseline_sharp, skipped_pages).
    Le pagine duplicate vengono saltate senza contarle.
    Se la validazione fallisce dopo max_attempts, la pagina viene saltata e si prosegue.

    Nota: se una pagina risulta "sgranata" ma è la PRIMA o l'ULTIMA
    del blocco richiesto, viene comunque acquisita.
    """
    skipped_pages = []
    saved_count_start = len(images)
    page_idx = 0

    while page_idx < num_pages:
        page_idx += 1
        current_page_num = saved_count_start + page_idx
        print(f"\n===============================")
        print(f"Pagina {page_idx}/{num_pages} (totale salvate finora: {len(images)})")
        print("===============================")

        attempt = 1
        img_ok = False
        current_img = None

        # Prima pagina "globale" se non hai ancora salvato nulla
        is_first_page_overall = (len(images) == 0 and page_idx == 1)
        # Ultima pagina del blocco richiesto in questa chiamata
        is_last_in_block = (page_idx == num_pages)

        while attempt <= max_attempts and not img_ok:
            if attempt == 1:
                wait_time = min_delay
            else:
                wait_time = 1.0
            print(f"  Tentativo {attempt}/{max_attempts} - attendo {wait_time:.1f}s...")
            time.sleep(wait_time)

            # Cattura schermata (all_screens per supporto multi-monitor)
            left, top, width, height = capture_region
            current_img = ImageGrab.grab(
                bbox=(left, top, left + width, top + height),
                all_screens=True
            )

            # Controllo duplicato (immagine intera)
            if is_same_as_previous(current_img, prev_page_img):
                print("  Risultato controllo: Immagine identica alla precedente, riprovo...")
                attempt += 1
                continue

            # Validazione qualità sui due quadranti
            ok, reason, sharp, fail_type = validate_image(
                current_img,
                baseline_sharpness=baseline_sharp
            )

            print(f"  Risultato controllo: {reason}")

            if ok:
                img_ok = True
                if baseline_sharp is None and sharp is not None:
                    baseline_sharp = sharp
                    print(f"  Baseline nitidezza impostata a: {baseline_sharp:.2f}")
            else:
                # Se è "solo" sgranata ma è prima o ultima pagina, accetto comunque
                if fail_type == "blurry" and (is_first_page_overall or is_last_in_block):
                    print("  Immagine sgranata ma accetto comunque perché è la prima/ultima pagina.")
                    img_ok = True
                    if baseline_sharp is None and sharp is not None:
                        baseline_sharp = sharp
                        print(f"  Baseline nitidezza impostata a: {baseline_sharp:.2f}")
                else:
                    attempt += 1

        if not img_ok:
            print(f"  [ATTENZIONE] Pagina {page_idx} non validata dopo {max_attempts} tentativi, la salto.")
            skipped_pages.append(current_page_num)
        else:
            images.append(current_img)
            prev_page_img = current_img
            print(f"  Pagina acquisita correttamente. (totale: {len(images)})")

        # Clicco per andare avanti (tranne l'ultima pagina del blocco)
        if page_idx < num_pages:
            print("  Clic per andare alla pagina successiva...")
            pag.click(next_x, next_y)

    return images, prev_page_img, baseline_sharp, skipped_pages


def save_pdf(images, output_pdf):
    """Salva la lista di immagini come PDF."""
    if not images:
        print("\nNessuna pagina acquisita. Non creo il PDF.")
        return False

    print(f"\nCreo il PDF con {len(images)} pagine...")
    pil_images = [img.convert("RGB") for img in images]

    first, *rest = pil_images
    try:
        first.save(
            output_pdf,
            save_all=True,
            append_images=rest
        )
        print(f"PDF creato con successo: {output_pdf}")
        print(f"Pagine salvate: {len(pil_images)}")
        return True
    except Exception as e:
        print(f"\n[ERRORE] Impossibile salvare il PDF: {e}")
        return False


# ==========================
#  Main
# ==========================

def main():
    print("==============================================")
    print("  CATTURA DOCUMENTO ONLINE -> PDF OFFLINE")
    print("==============================================\n")
    print("Assicurati di:")
    print("- Aver aperto il documento nel browser.")
    print("- Aver posizionato la copertina a pieno schermo nella zona da catturare.")
    print("- Disattivare eventuali popup/overlay che possono coprire il documento.\n")

    # 1) Parametri generali
    num_pages = ask_int("Quante pagine vuoi acquisire?", min_value=1)
    min_delay = ask_float("Tempo minimo di attesa tra cambio pagina e cattura (secondi)?", min_value=0.0)
    max_attempts = 5

    # 2) Area di cattura
    capture_region = choose_capture_region()

    # 3) Punto di click per pagina successiva
    print("\n--- PUNTO DI CLICK PER PAGINA SUCCESSIVA ---")
    next_x, next_y = wait_for_mouse_position(
        "Punto su cui cliccare per passare alla pagina successiva"
    )

    # 4) Percorso output
    output_pdf = ask_output_path()
    print(f"\nIl PDF finale sarà salvato in:\n  {output_pdf}\n")

    input("Quando sei pronto, posizionati sulla COPERTINA e premi INVIO per iniziare...")

    images = []
    prev_page_img = None
    baseline_sharp = None
    all_skipped = []

    # Prima sessione di acquisizione
    images, prev_page_img, baseline_sharp, skipped = acquire_pages(
        num_pages, min_delay, max_attempts, capture_region,
        next_x, next_y, images, prev_page_img, baseline_sharp
    )
    all_skipped.extend(skipped)

    # Ciclo: salva e chiedi se continuare
    while True:
        save_pdf(images, output_pdf)

        if all_skipped:
            print(f"\nPagine saltate (non validate): {all_skipped}")

        print("\n--- VUOI CONTINUARE? ---")
        risposta = input("Vuoi acquisire altre pagine? (s/N): ").strip().lower()
        if risposta != "s":
            print("Fine. Arrivederci!")
            break

        extra_pages = ask_int("Quante pagine aggiuntive?", min_value=1)

        # Clicco per avanzare alla prossima pagina prima di riprendere
        print("  Clic per andare alla pagina successiva...")
        pag.click(next_x, next_y)

        images, prev_page_img, baseline_sharp, skipped = acquire_pages(
            extra_pages, min_delay, max_attempts, capture_region,
            next_x, next_y, images, prev_page_img, baseline_sharp
        )
        all_skipped.extend(skipped)


if __name__ == "__main__":
    main()
