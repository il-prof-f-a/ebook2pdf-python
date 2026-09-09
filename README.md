<p align="center">
  <img src="extension/icons/icon128.png" alt="Ebook2PDF" width="128">
</p>

<h1 align="center">Ebook2PDF</h1>

<p align="center">
  Acquisisce le pagine visibili di ebook e documenti web autorizzati e le raccoglie in un PDF locale.<br>
  Disponibile come <strong>app desktop Python</strong> oppure come <strong>estensione Chromium</strong>, entrambe con OCR locale opzionale.
</p>

<p align="center">
  <strong>Autore:</strong> Il Prof. · <a href="https://github.com/il-prof-f-a">@il-prof-f-a</a><br>
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

Le due implementazioni condividono la stessa logica operativa. L'estensione può inoltre leggere segnali DOM come `document.readyState`, font, immagini, loader e `aria-busy`; la versione desktop resta invece indipendente dal browser e lavora esclusivamente sui pixel visibili sullo schermo.

---

# Installazione

Clona o scarica il repository:

```bash
git clone https://github.com/il-prof-f-a/ebook2pdf-python.git
cd ebook2pdf-python
```

Da qui puoi scegliere se utilizzare l'**app desktop Python**, l'**estensione browser**, oppure entrambe.

---

# App desktop Python

## Requisiti

- Python 3.10 o successivo;
- Tkinter;
- Tesseract OCR, necessario solo per creare PDF ricercabili.

Installa le dipendenze Python:

```bash
python -m pip install -r requirements.txt
```

Le dipendenze principali sono:

- `pyautogui` — click e coordinate mouse;
- `Pillow` — screenshot e immagini;
- `numpy` — confronto immagini e diagnostica;
- `PyMuPDF` — composizione PDF e layer OCR.

Tkinter è normalmente incluso nelle installazioni Windows di Python. Su alcune distribuzioni Linux può essere necessario installare il pacchetto di sistema `python3-tk`.

## Tesseract OCR

Per ottenere un PDF ricercabile è necessario installare anche **Tesseract OCR** nel sistema.

L'applicazione cerca automaticamente `tesseract` nel `PATH` e nei percorsi più comuni. Su Windows il percorso tipico è:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Il percorso può essere indicato manualmente da **⚙ Impostazioni → OCR** e verificato con **Test Tesseract**.

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

1. Apri il documento sulla prima pagina da acquisire.
2. Scegli il numero di pagine oppure abilita **Tutte**.
3. Premi **Seleziona area pagina**.
4. Durante il countdown posiziona il mouse sull'angolo superiore sinistro e poi su quello inferiore destro.
5. Premi **Seleziona punto avanti** e posiziona il mouse sul comando del viewer.
6. Scegli il PDF di destinazione.
7. Abilita eventualmente l'OCR.
8. Configura le opzioni avanzate tramite ⚙.
9. Premi **Avvia acquisizione**.

La GUI rimane responsiva perché acquisizione, OCR e composizione PDF vengono eseguiti in un worker thread separato. Il pulsante **Ferma** interrompe il flusso in modo controllato e conserva le pagine già acquisite.

## Rendering e modalità Tutte

Dopo ogni click Ebook2PDF:

1. attende il ritardo minimo configurato;
2. verifica che la pagina sia cambiata rispetto alla precedente;
3. acquisisce frame successivi;
4. considera pronta la pagina quando il numero configurato di confronti consecutivi resta sotto la soglia di stabilità.

La nitidezza viene utilizzata soltanto come informazione diagnostica e non causa lo scarto automatico di una pagina già stabilizzata.

In modalità **Tutte**, se i tentativi sul punto "pagina successiva" non producono più un cambiamento visivo sufficiente, Ebook2PDF considera raggiunta la fine del documento e passa automaticamente a OCR/PDF.

## OCR desktop

Parametri disponibili:

- lingua `ita`, `eng`, `ita+eng`;
- PSM 3, 4, 6, 11;
- `preserve_interword_spaces`;
- upscale OCR 1×–3×;
- percorso dell'eseguibile Tesseract.

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

L'ingrandimento OCR viene compensato nel DPI per mantenere il layer testuale allineato all'immagine originale.

Documentazione dettagliata: [`DESKTOP.md`](DESKTOP.md).

---

# Estensione browser

L'estensione Manifest V3 è contenuta nella cartella `extension/`.

## Installazione in Chrome, Edge o Brave

Dopo aver clonato o scaricato il repository, apri la pagina delle estensioni del browser:

- Chrome: `chrome://extensions/`
- Edge: `edge://extensions/`
- Brave: `brave://extensions/`

Poi:

1. attiva **Modalità sviluppatore**;
2. scegli **Carica estensione non pacchettizzata** / **Load unpacked**;
3. seleziona la cartella `extension/` del repository;
4. opzionalmente fissa Ebook2PDF nella barra degli strumenti.

Gli asset Tesseract.js, WebAssembly, i modelli `ita`/`eng` e `pdf-lib` necessari all'OCR sono inclusi nel repository.

Se vuoi rigenerarli o aggiornarli, su Windows PowerShell puoi eseguire:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

Su Linux, macOS o Git Bash:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

Dopo aver aggiornato i file dell'estensione, premi **Ricarica** nella pagina delle estensioni del browser.

## Utilizzo dell'estensione

1. Apri il documento sulla prima pagina.
2. Apri Ebook2PDF dalla sua icona.
3. Imposta un numero di pagine oppure seleziona **Tutte**.
4. Seleziona graficamente l'area della pagina.
5. Seleziona il comando DOM utilizzato per avanzare.
6. Abilita eventualmente l'OCR.
7. Modifica le impostazioni tramite ⚙.
8. Avvia l'acquisizione.

Con **Tutte**, l'estensione continua finché il comando "pagina successiva" non è più disponibile oppure non produce più un cambiamento della pagina. A quel punto passa automaticamente a OCR e generazione PDF.

## Rilevamento del completamento della pagina

L'estensione combina:

- verifica del cambiamento rispetto alla pagina precedente;
- stabilità visiva tra screenshot consecutivi;
- `document.readyState`;
- stato dei font;
- immagini non ancora complete;
- `aria-busy`;
- loader/spinner visibili;
- quiete delle mutazioni DOM.

La nitidezza resta un controllo diagnostico secondario.

Dettagli: [`extension/RENDER_READINESS.md`](extension/RENDER_READINESS.md).

## OCR dell'estensione

L'OCR viene eseguito localmente con Tesseract.js.

```text
JPEG originale
    ├──────────────→ immagine visibile nel PDF finale
    │
    └→ upscale OCR
          ↓
      Tesseract.js
          ↓
   PDF text-only nativo
          ↓
        pdf-lib
          ↓
JPEG originale + layer Tesseract
```

Tesseract gestisce direttamente geometria, baseline e spaziatura del layer testuale. Ebook2PDF mantiene il JPEG originale come contenuto visibile del PDF.

Dettagli: [`extension/OCR_TUNING.md`](extension/OCR_TUNING.md).

---

## 🎥 Video tutorial dell'estensione

> **Spazio riservato al video YouTube in cui verranno mostrati installazione e utilizzo di Ebook2PDF.**
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
