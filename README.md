<p align="center">
  <img src="extension/icons/icon128.png" alt="Ebook2PDF" width="128">
</p>

<h1 align="center">Ebook2PDF</h1>

<p align="center">
  Acquisisce le pagine visibili di ebook e documenti web autorizzati e le raccoglie in un PDF locale.<br>
  Disponibile come <strong>app desktop Python</strong> oppure come <strong>estensione Chromium</strong>, entrambe con OCR locale opzionale.
</p>

<p align="center">
  <strong>Autore:</strong> proffa<br>
  <strong>Repository:</strong> <a href="https://github.com/il-prof-f-a/ebook2pdf-python">github.com/il-prof-f-a/ebook2pdf-python</a>
</p>

> [!IMPORTANT]
> Ebook2PDF è pensato per documenti di cui si possiede il diritto o l'autorizzazione alla copia. Non implementa rimozione DRM, decifratura, recupero di contenuti nascosti o accesso a risorse non visibili all'utente.

---

## Due modalità di utilizzo

| | App desktop Python | Estensione browser |
|---|---|---|
| Ambiente | Windows / Linux / macOS | Chrome, Edge, Brave e Chromium compatibili |
| Interfaccia | Tkinter | pannello laterale Chromium |
| Selezione area | coordinate schermo con countdown | selezione grafica nel browser |
| Pagina successiva | coordinate del mouse | elemento DOM selezionato dall'utente |
| Numero pagine | numero definito oppure **Tutte** | numero definito oppure **Tutte** |
| Fine documento automatica | assenza di cambiamento dopo i retry | scomparsa del controllo avanti o assenza di cambiamento |
| Fine rendering | stabilità visiva | stabilità visiva + segnali DOM |
| Nitidezza | diagnostica | diagnostica |
| OCR | **Tesseract nativo locale** | **Tesseract.js locale** |
| PDF ricercabile | Tesseract text-only + PyMuPDF | Tesseract text-only + pdf-lib |
| Configurazione | `~/.ebook2pdf/config.json` | `chrome.storage.local` |

Le due implementazioni condividono quindi la stessa logica operativa. L'estensione ha un vantaggio aggiuntivo nei viewer web perché può leggere segnali DOM come `document.readyState`, font, immagini, loader e `aria-busy`; la versione desktop resta invece indipendente dal browser e lavora esclusivamente sui pixel visibili sullo schermo.

---

# App desktop Python

La versione desktop è sviluppata sul branch:

```bash
git checkout python-desktop-gui
```

## Installazione

Richiede Python 3.10 o successivo.

```bash
git clone https://github.com/il-prof-f-a/ebook2pdf-python.git
cd ebook2pdf-python
git checkout python-desktop-gui
python -m pip install -r requirements.txt
```

Dipendenze Python principali:

- `pyautogui` — click e coordinate mouse;
- `Pillow` — screenshot e immagini;
- `numpy` — confronto immagini e diagnostica;
- `PyMuPDF` — composizione PDF e layer OCR.

Tkinter è normalmente incluso in Python su Windows. Su alcune distribuzioni Linux può essere necessario installare `python3-tk`.

### Tesseract

Per il PDF ricercabile serve anche **Tesseract OCR** installato nel sistema.

L'app cerca automaticamente `tesseract` nel `PATH` e nei percorsi più comuni. Su Windows, tipicamente:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Il percorso può essere impostato da **⚙ Impostazioni → OCR** e verificato tramite **Test Tesseract**.

Per usare `ita+eng` devono essere installati entrambi i modelli lingua.

## Avvio

```bash
python ebook2pdf.py
```

oppure:

```bash
python -m ebook2pdf_app
```

## Utilizzo desktop

1. apri il documento sulla prima pagina da acquisire;
2. scegli il numero di pagine oppure abilita **Tutte**;
3. premi **Seleziona area pagina**;
4. durante il countdown posiziona il mouse sull'angolo superiore sinistro e poi su quello inferiore destro;
5. premi **Seleziona punto avanti** e posiziona il mouse sul comando del viewer;
6. scegli il PDF di destinazione;
7. abilita eventualmente l'OCR;
8. configura le opzioni avanzate tramite ⚙;
9. premi **Avvia acquisizione**.

La GUI rimane responsiva perché acquisizione, OCR e composizione PDF vengono eseguiti in un worker thread separato.

Il pulsante **Ferma** interrompe il flusso in modo controllato e conserva le pagine già acquisite.

## Rendering e modalità Tutte

Dopo ogni click Ebook2PDF:

1. attende il ritardo minimo;
2. verifica il cambiamento rispetto alla pagina precedente;
3. acquisisce frame successivi;
4. considera pronta la pagina dopo il numero configurato di confronti consecutivi sotto la soglia di stabilità.

La nitidezza resta soltanto diagnostica e non fa più saltare una pagina già stabilizzata.

In modalità **Tutte**, se tutti i retry sul punto "pagina successiva" non producono un cambiamento visivo sufficiente, la fine del documento viene considerata raggiunta e il programma passa a OCR/PDF.

## OCR desktop

Parametri disponibili:

- lingua `ita`, `eng`, `ita+eng`;
- PSM 3, 4, 6, 11;
- `preserve_interword_spaces`;
- upscale OCR 1×–3×;
- percorso eseguibile Tesseract.

Pipeline:

```text
JPEG originale
    ├──────────────→ immagine visibile nel PDF finale
    │
    └→ upscale OCR
          ↓
       Tesseract
          ↓
   PDF text-only nativo
          ↓
       PyMuPDF
          ↓
JPEG originale + layer OCR
```

L'ingrandimento OCR viene compensato nel DPI, in modo da mantenere il layer testuale allineato all'immagine originale.

Documentazione dettagliata: [`DESKTOP.md`](DESKTOP.md).

---

# Estensione browser

L'estensione Manifest V3 è contenuta in `extension/` ed è già integrata nel branch `main` del repository.

## Installazione

Clona o scarica normalmente il repository; non è necessario passare a un branch dedicato:

```bash
git clone https://github.com/il-prof-f-a/ebook2pdf-python.git
cd ebook2pdf-python
```

Apri quindi:

- Chrome: `chrome://extensions/`
- Edge: `edge://extensions/`
- Brave: `brave://extensions/`

Poi:

1. attiva **Modalità sviluppatore**;
2. scegli **Carica estensione non pacchettizzata** / **Load unpacked**;
3. seleziona la cartella `extension/`;
4. opzionalmente fissa Ebook2PDF nella barra degli strumenti.

Gli asset Tesseract.js, WASM, `ita`/`eng` e `pdf-lib` correnti sono inclusi nel repository. Per rigenerarli:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

oppure:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

## Utilizzo dell'estensione

1. apri il documento sulla prima pagina;
2. apri Ebook2PDF dalla sua icona;
3. imposta un numero di pagine oppure **Tutte**;
4. seleziona graficamente l'area pagina;
5. seleziona il comando DOM per avanzare;
6. abilita eventualmente l'OCR;
7. modifica le impostazioni tramite ⚙;
8. avvia l'acquisizione.

La fine del rendering combina stabilità visiva e segnali DOM. Dettagli: [`extension/RENDER_READINESS.md`](extension/RENDER_READINESS.md).

La pipeline OCR usa il renderer PDF text-only nativo di Tesseract.js e mantiene il JPEG originale come contenuto visibile. Dettagli: [`extension/OCR_TUNING.md`](extension/OCR_TUNING.md).

---

## 🎥 Video tutorial dell'estensione

> **Spazio riservato al video YouTube in cui viene mostrata l'installazione e l'utilizzo di Ebook2PDF.**
>
> Inserire qui il link o l'ID del video quando sarà pubblicato.

<!--
Sostituire VIDEO_ID e rimuovere il commento quando il video sarà disponibile:

[![Video tutorial Ebook2PDF](https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=VIDEO_ID)
-->

---

## Struttura del progetto

```text
ebook2pdf-python/
├── ebook2pdf.py                 # launcher desktop
├── requirements.txt
├── DESKTOP.md
├── ebook2pdf_app/
│   ├── __init__.py
│   ├── __main__.py
│   ├── settings.py
│   ├── capture.py
│   ├── render.py
│   ├── ocr.py
│   ├── pdf.py
│   └── gui.py
└── extension/
    ├── manifest.json
    ├── background.js
    ├── content.js
    ├── sidepanel.html
    ├── sidepanel.css
    ├── sidepanel.js
    ├── acquisition-end-fallback.js
    ├── branding.js
    ├── ocr.js
    ├── native-pdf.js
    ├── icons/
    ├── lib/
    ├── tessdata/
    └── scripts/
```

## Privacy

Entrambe le versioni eseguono acquisizione, OCR e composizione PDF localmente. Non sono richieste API OCR cloud e Ebook2PDF non invia intenzionalmente le pagine a servizi esterni.

## Limiti noti

- l'acquisizione riguarda solo ciò che è visibile e renderizzato;
- la versione desktop non dispone dei segnali DOM del viewer;
- l'estensione può essere limitata da iframe cross-origin o viewer particolari;
- documenti molto lunghi, soprattutto con OCR e upscale elevato, possono richiedere molta RAM;
- la qualità OCR dipende da risoluzione, contrasto, font e layout della pagina;
- nessuna delle due modalità può garantire compatibilità con ogni viewer.

## Nota legale ed etica

Utilizza Ebook2PDF esclusivamente con contenuti per i quali disponi dei diritti o di una esplicita autorizzazione alla copia e all'uso offline. Rispetta copyright, licenze d'uso e condizioni di servizio della piattaforma che ospita il documento.
