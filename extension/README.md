# 📚 Ebook2PDF Browser Extension

Prima versione sperimentale dell'estensione Chromium di Ebook2PDF.

L'estensione riproduce nel browser la logica dello script Python originale: selezione dell'area da catturare, avanzamento pagina, controlli di qualità e generazione di un PDF multipagina.

> Usare esclusivamente con documenti per i quali si dispone del diritto o dell'autorizzazione alla copia. L'estensione non implementa funzioni di rimozione DRM, decifratura o accesso a contenuti non visibili all'utente.

## Funzioni presenti nella v0.1

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
- generazione PDF interamente locale, senza servizi esterni.

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

## Utilizzo

1. Aprire nel browser il documento da acquisire e posizionarsi sulla prima pagina desiderata.
2. Fare clic sull'icona di Ebook2PDF: si apre il pannello laterale.
3. Impostare numero di pagine, ritardo e numero massimo di tentativi.
4. Premere **Seleziona area pagina** e trascinare il rettangolo sull'area da includere nel PDF.
5. Premere **Seleziona pulsante avanti** e fare clic sul controllo del viewer che porta alla pagina successiva.
6. Premere **Avvia acquisizione**.
7. Al termine viene richiesto dove salvare il PDF.

## Logica dei controlli

Per ogni pagina l'estensione:

1. cattura la scheda visibile;
2. ritaglia la regione scelta;
3. confronta il risultato con la pagina precedente;
4. controlla i quadranti alto-sinistra e basso-destra;
5. verifica che i quadranti non siano quasi monocolore;
6. stima la nitidezza e la confronta con la baseline;
7. in caso di fallimento riprova senza cambiare pagina;
8. al termine dei tentativi marca la pagina come saltata e procede con la successiva.

Come nello script Python, una prima o ultima pagina che fallisce soltanto il controllo di nitidezza può essere accettata.

## Limiti noti della v0.1

- le immagini JPEG delle pagine vengono mantenute in memoria fino alla creazione finale del PDF: su documenti molto lunghi il consumo di RAM può diventare importante;
- il comando "avanti" deve essere un elemento raggiungibile dal DOM principale; controlli dentro iframe cross-origin o viewer particolari richiederanno un adattamento;
- non è ancora implementato il salvataggio/ripristino di una sessione interrotta;
- non è ancora presente una modalità di riconoscimento automatico del viewer;
- il PDF contiene immagini e non un layer OCR ricercabile.

## Struttura

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
└── README.md
```

## Sviluppi successivi suggeriti

- persistenza dello stato con `chrome.storage.local`;
- gestione per blocchi per ridurre il consumo di memoria;
- selezione di elementi dentro iframe quando consentito;
- profili specifici per viewer noti;
- riconoscimento automatico del controllo pagina successiva;
- esportazione delle pagine fallite e diagnostica avanzata;
- eventuale OCR locale opzionale.