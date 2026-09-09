# 📚 Ebook2PDF Browser Extension

Estensione Chromium di Ebook2PDF.

L'estensione riproduce nel browser la logica dello script Python originale: selezione dell'area da catturare, avanzamento pagina, controlli di qualità e generazione di un PDF multipagina. Dalla v0.2 può inoltre eseguire un OCR locale opzionale con Tesseract.js e produrre un PDF ricercabile e con testo selezionabile.

> Usare esclusivamente con documenti per i quali si dispone del diritto o dell'autorizzazione alla copia. L'estensione non implementa funzioni di rimozione DRM, decifratura o accesso a contenuti non visibili all'utente.

## Funzioni presenti nella v0.2

- Manifest V3;
- pannello laterale persistente;
- selezione grafica dell'area della pagina;
- selezione del comando "pagina successiva" direttamente nel DOM;
- screenshot della scheda con `chrome.tabs.captureVisibleTab()`;
- crop automatico tenendo conto della scala tra coordinate CSS e screenshot reale;
- rilevamento pagine duplicate con tolleranza;
- controllo dei quadranti alto-sinistra e basso-destra;
- rilevamento di aree quasi monocolore;
- stima della nitidezza e confronto con la baseline della prima pagina valida;
- retry configurabile;
- elenco delle pagine saltate;
- stop manuale;
- generazione PDF interamente locale, senza servizi esterni;
- OCR locale opzionale con Tesseract.js;
- lingue OCR: italiano, inglese, italiano + inglese;
- avanzamento OCR pagina per pagina;
- text layer invisibile nel PDF, per ricerca e selezione del testo;
- fallback automatico al PDF normale se gli asset OCR non sono disponibili o Tesseract genera un errore.

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

L'estensione funziona anche senza gli asset Tesseract, ma in quel caso la modalità OCR non è utilizzabile.

## Installazione degli asset OCR

Gli asset JavaScript, WebAssembly e i modelli lingua di Tesseract devono essere inclusi localmente nella cartella `extension/`, perché Manifest V3 non deve caricare codice eseguibile remoto.

Istruzioni complete: [`OCR_ASSETS.md`](OCR_ASSETS.md).

Metodo rapido su Windows PowerShell, dalla root del repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

Su Linux/macOS/Git Bash:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

Al termine ricaricare l'estensione dalla pagina `chrome://extensions/`.

## Utilizzo

1. Aprire nel browser il documento da acquisire e posizionarsi sulla prima pagina desiderata.
2. Fare clic sull'icona di Ebook2PDF: si apre il pannello laterale.
3. Impostare numero di pagine, ritardo e numero massimo di tentativi.
4. Premere **Seleziona area pagina** e trascinare il rettangolo sull'area da includere nel PDF.
5. Premere **Seleziona pulsante avanti** e fare clic sul controllo del viewer che porta alla pagina successiva.
6. Facoltativamente attivare **Crea PDF ricercabile con OCR locale** e scegliere la lingua.
7. Premere **Avvia acquisizione**.
8. Se l'OCR è abilitato, al termine della cattura viene mostrato un secondo avanzamento pagina per pagina.
9. Al termine viene richiesto dove salvare il PDF.

Quando il layer OCR è stato creato correttamente, il nome proposto contiene il suffisso `_ocr.pdf`.

## Flusso OCR

```text
pagine JPEG acquisite
        ↓
Tesseract.js locale / WebAssembly
        ↓
testo + bounding box delle parole
        ↓
generatore PDF Ebook2PDF
        ↓
immagine originale + testo invisibile
        ↓
PDF ricercabile e selezionabile
```

Il testo OCR viene inserito con rendering invisibile sopra l'immagine originale. La resa grafica del documento quindi non cambia: il layer aggiuntivo serve esclusivamente a ricerca, selezione e copia del testo.

Le coordinate Tesseract hanno origine in alto a sinistra, mentre il PDF usa l'origine in basso a sinistra; Ebook2PDF effettua automaticamente la trasformazione e lo scaling delle bounding box.

## Privacy OCR

Tesseract.js, il core WebAssembly e i modelli `ita`/`eng` vengono caricati dalla stessa estensione. Durante il riconoscimento le immagini non vengono inviate a Google, Microsoft, AWS o altri servizi OCR esterni.

## Logica dei controlli

Per ogni pagina l'estensione:

1. cattura la scheda visibile;
2. ritaglia la regione scelta;
3. confronta il risultato con la pagina precedente;
4. controlla i quadranti alto-sinistra e basso-destra;
5. verifica che i quadranti non siano quasi monocolore;
6. stima la nitidezza e la confronta con la baseline;
7. in caso di fallimento riprova senza cambiare pagina;
8. al termine dei tentativi marca la pagina come saltata e procede con la successiva;
9. se richiesto, esegue OCR sulle pagine valide;
10. genera il PDF finale.

Come nello script Python, una prima o ultima pagina che fallisce soltanto il controllo di nitidezza può essere accettata.

## Comportamento in caso di errore OCR

L'OCR è uno step aggiuntivo e non deve compromettere l'acquisizione già eseguita. Se Tesseract non può essere inizializzato, gli asset sono mancanti o si verifica un errore durante il riconoscimento, Ebook2PDF:

1. scrive l'errore nel log;
2. conserva tutte le pagine già acquisite;
3. crea comunque il PDF normale senza layer OCR.

## Limiti noti della v0.2

- le immagini JPEG delle pagine vengono mantenute in memoria fino alla creazione finale del PDF: su documenti molto lunghi il consumo di RAM può diventare importante;
- con OCR attivo aumentano ulteriormente tempo di elaborazione e memoria usata;
- il comando "avanti" deve essere un elemento raggiungibile dal DOM principale; controlli dentro iframe cross-origin o viewer particolari richiederanno un adattamento;
- non è ancora implementato il salvataggio/ripristino di una sessione interrotta;
- non è ancora presente una modalità di riconoscimento automatico del viewer;
- il text layer usa Helvetica/WinAnsi: italiano e inglese sono gestiti bene, mentre caratteri Unicode fuori da tale insieme vengono sostituiti nel layer invisibile;
- l'accuratezza del testo dipende dalla qualità e dalla risoluzione della pagina catturata.

## Struttura

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── ocr.js
├── OCR_ASSETS.md
├── scripts/
│   ├── install-tesseract-assets.ps1
│   └── install-tesseract-assets.sh
├── lib/
│   ├── tesseract/          # da aggiungere localmente
│   └── tesseract-core/     # da aggiungere localmente
├── tessdata/               # da aggiungere localmente
└── README.md
```

## Sviluppi successivi suggeriti

- persistenza dello stato con `chrome.storage.local`;
- gestione per blocchi per ridurre il consumo di memoria;
- font Unicode incorporato nel layer OCR;
- selezione di elementi dentro iframe quando consentito;
- profili specifici per viewer noti;
- riconoscimento automatico del controllo pagina successiva;
- esportazione delle pagine fallite e diagnostica avanzata.