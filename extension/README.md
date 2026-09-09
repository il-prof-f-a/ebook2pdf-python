# 📚 Ebook2PDF Browser Extension

Estensione Chromium di Ebook2PDF.

L'estensione riproduce nel browser la logica dello script Python originale: selezione dell'area da catturare, avanzamento pagina, controlli di qualità e generazione di un PDF multipagina. La v0.5.0 include OCR locale con Tesseract.js e usa il renderer PDF nativo di Tesseract per il layer testuale.

> Usare esclusivamente con documenti per i quali si dispone del diritto o dell'autorizzazione alla copia. L'estensione non implementa funzioni di rimozione DRM, decifratura o accesso a contenuti non visibili all'utente.

## Funzioni principali

- Manifest V3;
- pannello laterale persistente;
- selezione grafica dell'area della pagina;
- selezione del comando "pagina successiva" direttamente nel DOM;
- iniezione automatica del content script quando necessario;
- screenshot della scheda con `chrome.tabs.captureVisibleTab()`;
- crop automatico tenendo conto della scala tra coordinate CSS e screenshot reale;
- rilevamento pagine duplicate;
- controllo aree quasi monocolore;
- controllo nitidezza relativo alla baseline della prima pagina valida;
- ratio nitidezza configurabile;
- ritardo tra cambio pagina e retry configurabili;
- elenco pagine saltate e stop manuale;
- OCR locale opzionale con Tesseract.js;
- italiano, inglese o italiano + inglese;
- PSM Tesseract configurabile;
- `preserve_interword_spaces` configurabile;
- upscale dell'immagine usata dal solo OCR, predefinito 2×;
- PDF OCR costruito con **layer text-only nativo di Tesseract + JPEG originale**;
- composizione multipagina locale tramite `pdf-lib`;
- fallback automatico al PDF normale in caso di errore OCR o composizione.

## Installazione in Chrome / Edge / Brave

1. Passare al branch `browser-extension` del repository.
2. Scaricare o clonare il repository.
3. Aprire la pagina delle estensioni del browser:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
4. Attivare **Modalità sviluppatore**.
5. Scegliere **Carica estensione non pacchettizzata** / **Load unpacked**.
6. Selezionare la cartella `extension/`.

## Asset OCR locali

Per usare l'OCR servono Tesseract.js, il core WASM, i modelli lingua e `pdf-lib`.

Istruzioni complete: [`OCR_ASSETS.md`](OCR_ASSETS.md).

Metodo rapido su Windows PowerShell, dalla root del repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

Su Linux/macOS/Git Bash:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

Dalla v0.5.0 lo script installa anche:

```text
extension/lib/pdf-lib/pdf-lib.min.js
```

Dopo l'installazione ricaricare l'estensione dalla pagina `chrome://extensions/`.

## Utilizzo

1. Aprire il documento e posizionarsi sulla prima pagina da acquisire.
2. Aprire Ebook2PDF dal pulsante dell'estensione.
3. Impostare il numero di pagine.
4. Premere **Seleziona area pagina** e trascinare il rettangolo.
5. Premere **Seleziona pulsante avanti** e scegliere il controllo del viewer.
6. Se desiderato, attivare **Crea PDF ricercabile con OCR locale**.
7. Le opzioni avanzate sono disponibili tramite il pulsante ⚙️ accanto al titolo.
8. Premere **Avvia acquisizione**.
9. Con OCR attivo vengono eseguiti tre step: acquisizione, OCR, composizione PDF.

Quando il PDF OCR viene prodotto correttamente il nome contiene il suffisso `_ocr.pdf`.

## OCR v0.5.0

La pipeline non ricostruisce più manualmente il testo tramite bounding box e Helvetica.

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
immagine originale + layer Tesseract
          ↓
PDF ricercabile e selezionabile
```

Tesseract decide direttamente font, baseline, spaziatura e geometria del proprio layer PDF. Ebook2PDF non riposiziona più parole o righe manualmente.

L'upscale OCR è indipendente dall'immagine finale. Il DPI passato a Tesseract viene moltiplicato per lo stesso fattore, così il PDF text-only mantiene le stesse dimensioni fisiche della pagina originale e resta allineato al JPEG.

## Impostazioni acquisizione

Le impostazioni sono persistenti tramite `chrome.storage.local`:

- attesa dopo cambio pagina;
- attesa tra retry;
- tentativi massimi;
- ratio minimo di nitidezza rispetto alla baseline;
- controllo duplicati;
- controllo caricamento/nitidezza.

La soglia di nitidezza è calcolata come:

```text
soglia = baseline × ratio
```

Il default è `0.50`.

## Impostazioni OCR

- lingua: italiano, inglese, italiano + inglese;
- PSM 3, 4, 6 o 11;
- preservazione spazi tra parole;
- upscale OCR da 1× a 3×, default 2×.

Per dettagli sui PSM: [`OCR_TUNING.md`](OCR_TUNING.md).

## Privacy OCR

Tesseract.js, il core WebAssembly, i modelli lingua e pdf-lib sono caricati dalla stessa estensione. Le pagine non vengono inviate a Google, Microsoft, AWS o altri servizi OCR esterni.

## Comportamento in caso di errore OCR

L'OCR non deve compromettere l'acquisizione già eseguita. Se Tesseract o pdf-lib non possono essere inizializzati:

1. l'errore viene scritto nel log;
2. le immagini acquisite vengono conservate;
3. viene creato il PDF normale senza OCR.

## Limiti noti

- immagini JPEG e PDF text-only OCR vengono mantenuti in memoria fino alla composizione finale: documenti molto lunghi possono richiedere molta RAM;
- l'upscale OCR aumenta tempo e memoria;
- il comando "avanti" deve essere raggiungibile dal DOM principale;
- iframe cross-origin e viewer particolari possono richiedere adattamenti;
- non è ancora presente il salvataggio/ripristino di una sessione interrotta;
- la qualità OCR dipende dalla risoluzione, dal contrasto e dal layout del documento.

## Struttura principale

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── ocr.js
├── native-pdf.js
├── OCR_ASSETS.md
├── OCR_TUNING.md
├── scripts/
│   ├── install-tesseract-assets.ps1
│   └── install-tesseract-assets.sh
├── lib/
│   ├── tesseract/
│   ├── tesseract-core/
│   └── pdf-lib/
├── tessdata/
│   ├── ita.traineddata.gz
│   └── eng.traineddata.gz
└── README.md
```

## Sviluppi successivi suggeriti

- persistenza dello stato di una sessione interrotta;
- gestione per blocchi/IndexedDB per ridurre l'uso della RAM;
- selezione di elementi dentro iframe quando consentito;
- profili specifici per viewer noti;
- re-OCR selettivo di regioni a bassa confidenza;
- diagnostica avanzata delle pagine OCR.