# Ebook2PDF Browser Extension

<p align="center">
  <img src="icons/icon128.png" alt="Ebook2PDF" width="112">
</p>

Estensione Chromium di **Ebook2PDF** per acquisire le pagine visibili di ebook e documenti web autorizzati, creare PDF locali e aggiungere OCR opzionale con Tesseract.js.

**Autore:** Il Prof. · [@il-prof-f-a](https://github.com/il-prof-f-a)  
**Repository:** [il-prof-f-a/ebook2pdf-python](https://github.com/il-prof-f-a/ebook2pdf-python)

Per la documentazione generale del progetto, compresa l'**app desktop Python**, consulta il [`README.md`](../README.md) nella root del repository.

> Usare esclusivamente con documenti per i quali si dispone del diritto o dell'autorizzazione alla copia. L'estensione non implementa rimozione DRM, decifratura o accesso a contenuti non visibili all'utente.

## Funzioni principali

- Manifest V3 e pannello laterale persistente;
- icona e branding Ebook2PDF;
- selezione grafica dell'area della pagina;
- selezione del comando "pagina successiva" direttamente nel DOM;
- supporto a pulsanti, link, SVG e componenti custom tramite fallback pointer/mouse;
- acquisizione di un numero definito di pagine oppure modalità **Tutte**;
- fine documento automatica quando il comando avanti non è più disponibile;
- controllo del cambio pagina e convergenza temporale tra frame;
- confronto relativo di pixel, bordi, contrasto e distribuzione luminosa;
- rilevamento prudente di placeholder centrali su fondo uniforme;
- segnali DOM avanzati: ready state, font, immagini, loader, overlay, animazioni, cursori di attesa e filtri CSS;
- pausa automatica se la scheda documento perde il focus;
- recupero automatico dei canali di messaggistica Chromium quando possibile;
- banner interattivo sugli errori di acquisizione con **Riprova e continua** oppure **Chiudi e genera PDF**;
- protezione contro il doppio avanzamento dopo un errore incerto del comando pagina successiva;
- qualità JPEG configurabile per ridurre il peso del PDF;
- impostazioni persistenti in `chrome.storage.local`;
- OCR locale con Tesseract.js;
- italiano, inglese o italiano + inglese;
- PSM Tesseract configurabile;
- `preserve_interword_spaces` configurabile;
- upscale OCR 1×–3×, default 2×;
- PDF ricercabile tramite layer text-only nativo Tesseract + JPEG originale;
- composizione locale multipagina con `pdf-lib`;
- fallback al PDF normale in caso di errore OCR.

## Installazione

1. Clona o scarica il repository:

   ```bash
   git clone https://github.com/il-prof-f-a/ebook2pdf-python.git
   cd ebook2pdf-python
   ```

2. Apri la pagina delle estensioni:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
3. Attiva **Modalità sviluppatore**.
4. Premi **Carica estensione non pacchettizzata** / **Load unpacked**.
5. Seleziona la cartella `extension/`.

Gli asset OCR correnti sono inclusi nel repository. Per rigenerarli consulta [`OCR_ASSETS.md`](OCR_ASSETS.md).

## Utilizzo

1. Apri il documento sulla prima pagina da acquisire.
2. Apri Ebook2PDF dalla sua icona.
3. Imposta il numero di pagine oppure seleziona **Tutte**.
4. Seleziona l'area pagina.
5. Seleziona il comando per avanzare.
6. Attiva l'OCR se vuoi un PDF ricercabile.
7. Configura eventualmente le opzioni tramite ⚙️.
8. Avvia l'acquisizione.

Con **Tutte**, l'estensione continua finché il comando avanti scompare o non produce più un cambiamento valido; a quel punto passa automaticamente a OCR e PDF.

## Rendering pagina

Dalla v0.9 Ebook2PDF valuta la **convergenza temporale della singola pagina**. Non usa una soglia assoluta ricavata da altre pagine: aspetta che pixel, bordi, contrasto e distribuzione luminosa smettano di evolvere per più controlli consecutivi, quindi verifica overlay, loader e segnali DOM.

Dettagli: [`RENDER_READINESS.md`](RENDER_READINESS.md).

## Recupero dagli errori

Gli errori di acquisizione non chiudono più automaticamente una scansione già avviata. L'estensione mette in pausa il flusso e mostra nel side panel un banner rosso con il messaggio ricevuto e due azioni:

- **Riprova e continua**: riprende dalla pagina corrente senza eliminare le pagine già acquisite;
- **Chiudi e genera PDF**: termina l'acquisizione e procede con OCR/PDF usando quanto già raccolto.

Gli errori transitori del canale di messaggistica Chromium vengono ritentati automaticamente per le operazioni di sola lettura. Se l'interruzione avviene durante il comando **pagina successiva**, Ebook2PDF non ripete subito il click: al retry confronta prima lo schermo con la pagina precedente, così evita un possibile doppio avanzamento se il click era stato eseguito ma la relativa risposta era andata persa.

## OCR e PDF

```text
JPEG originale
    ├──────────────→ immagine visibile finale
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

Tesseract gestisce direttamente baseline, spaziatura e geometria del layer OCR. Ebook2PDF conserva invece il JPEG originale come contenuto visibile.

Dettagli: [`OCR_TUNING.md`](OCR_TUNING.md).

## Privacy

Tesseract.js, i modelli lingua, il core WebAssembly e `pdf-lib` sono eseguiti localmente dall'estensione. Le immagini non vengono intenzionalmente inviate a servizi OCR cloud.

## Struttura principale

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── content-readiness.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── acquisition-end-fallback.js
├── capture-resilience.js
├── jpeg-compression.js
├── render-readiness-convergence.js
├── pdf-output-branding.js
├── branding.js
├── ocr.js
├── native-pdf.js
├── icons/
├── lib/
├── tessdata/
├── scripts/
├── OCR_ASSETS.md
├── OCR_TUNING.md
└── RENDER_READINESS.md
```

## Limiti noti

- iframe cross-origin e viewer molto particolari possono impedire l'accesso al comando avanti;
- documenti molto lunghi possono richiedere molta memoria;
- l'upscale OCR aumenta tempi e RAM;
- l'accuratezza OCR dipende dalla qualità grafica della pagina;
- il rilevamento di placeholder e overlay è euristico e può richiedere ulteriore taratura su viewer particolari;
- non è ancora presente il salvataggio/ripristino di una sessione interrotta.
