# 🔎 Asset locali per OCR Tesseract.js

L'OCR di Ebook2PDF è progettato per funzionare **interamente in locale**. Per rispettare Manifest V3, il codice JavaScript/WebAssembly di Tesseract non viene caricato da CDN: gli asset devono essere presenti dentro la cartella `extension/`.

## Versioni previste

- `tesseract.js` 7.0.0
- `tesseract.js-core` 7.0.0
- `@tesseract.js-data/ita` 1.0.0
- `@tesseract.js-data/eng` 1.0.0

## Struttura attesa

```text
extension/
├── lib/
│   ├── tesseract/
│   │   ├── tesseract.min.js
│   │   └── worker.min.js
│   └── tesseract-core/
│       ├── tesseract-core.js
│       ├── tesseract-core.wasm
│       ├── tesseract-core.wasm.js
│       ├── tesseract-core-lstm.js
│       ├── tesseract-core-lstm.wasm
│       ├── tesseract-core-lstm.wasm.js
│       ├── tesseract-core-simd.js
│       ├── tesseract-core-simd.wasm
│       ├── tesseract-core-simd.wasm.js
│       ├── tesseract-core-simd-lstm.js
│       ├── tesseract-core-simd-lstm.wasm
│       ├── tesseract-core-simd-lstm.wasm.js
│       └── eventuali ulteriori varianti presenti nel pacchetto 7.x
└── tessdata/
    ├── ita.traineddata.gz
    └── eng.traineddata.gz
```

È consigliato copiare **tutti** i file `tesseract-core*` forniti dal pacchetto `tesseract.js-core`, così Tesseract può scegliere automaticamente la variante WASM adatta al browser.

## Metodo automatico consigliato

Dalla root del repository, su Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

Su Linux/macOS/Git Bash:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

Gli script installano temporaneamente i pacchetti npm, copiano solo gli asset necessari dentro `extension/` e rimuovono la directory temporanea.

## Metodo manuale con npm

Installa i pacchetti in una directory temporanea:

```bash
npm install --prefix .tesseract-assets-tmp --ignore-scripts --no-save \
  tesseract.js@7.0.0 \
  tesseract.js-core@7.0.0 \
  @tesseract.js-data/ita@1.0.0 \
  @tesseract.js-data/eng@1.0.0
```

Poi copia:

```text
.tesseract-assets-tmp/node_modules/tesseract.js/dist/tesseract.min.js
    -> extension/lib/tesseract/tesseract.min.js

.tesseract-assets-tmp/node_modules/tesseract.js/dist/worker.min.js
    -> extension/lib/tesseract/worker.min.js

.tesseract-assets-tmp/node_modules/tesseract.js-core/tesseract-core*
    -> extension/lib/tesseract-core/

.tesseract-assets-tmp/node_modules/@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz
    -> extension/tessdata/ita.traineddata.gz

.tesseract-assets-tmp/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
    -> extension/tessdata/eng.traineddata.gz
```

Infine puoi eliminare `.tesseract-assets-tmp`.

## Verifica rapida

Dopo aver aggiunto gli asset:

1. apri `chrome://extensions/`;
2. premi **Aggiorna/Ricarica** sull'estensione Ebook2PDF;
3. apri il pannello laterale;
4. abilita **Crea PDF ricercabile con OCR**;
5. acquisisci inizialmente 1-2 pagine per il test.

Se `tesseract.min.js`, il worker, il core WASM o i modelli lingua non sono presenti, l'acquisizione normale continuerà a funzionare; l'errore verrà mostrato soltanto quando si tenta lo step OCR.

## Licenze

Tesseract.js e tesseract.js-core sono distribuiti con licenza Apache-2.0. I pacchetti `@tesseract.js-data/*` sono distribuiti separatamente; conserva le relative informazioni di licenza se gli asset vengono redistribuiti con una release pubblica dell'estensione.