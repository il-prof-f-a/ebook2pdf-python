# Ebook2PDF Desktop

La versione desktop porta nello script Python la stessa filosofia operativa sviluppata per l'estensione browser: parametri persistenti, attesa del rendering basata sulla stabilità visiva, modalità **Tutte**, OCR Tesseract locale e PDF ricercabile.

## Avvio rapido

```bash
python -m pip install -r requirements.txt
python ebook2pdf.py
```

Tkinter è incluso normalmente nelle installazioni Windows di Python. Su alcune distribuzioni Linux può essere necessario installare il pacchetto di sistema `python3-tk`.

## Tesseract OCR

L'OCR richiede anche l'eseguibile Tesseract installato nel sistema. L'applicazione prova a rilevarlo automaticamente nei percorsi più comuni e tramite `PATH`.

Su Windows il percorso tipico è:

```text
C:\Program Files\Tesseract-OCR\tesseract.exe
```

Il percorso può essere impostato manualmente in **⚙ Impostazioni → OCR** e verificato con **Test Tesseract**.

Per usare italiano e inglese devono essere disponibili i modelli `ita` e `eng` nell'installazione Tesseract.

## Interfaccia

La finestra principale permette di:

- scegliere un numero preciso di pagine oppure **Tutte**;
- selezionare l'area della pagina;
- selezionare il punto da cliccare per avanzare;
- scegliere il file PDF di destinazione;
- attivare/disattivare l'OCR;
- avviare e fermare l'acquisizione;
- seguire avanzamento e log.

Le impostazioni avanzate sono disponibili dal pulsante ⚙.

## Selezione area e punto avanti

La versione desktop non dispone del DOM del browser. Per restare indipendente dal browser e dal viewer usa quindi coordinate di schermo.

Quando viene avviata una selezione parte un conto alla rovescia di 3 secondi:

1. posizionare il mouse nel punto richiesto;
2. attendere la fine del conto alla rovescia;
3. Ebook2PDF registra automaticamente le coordinate correnti.

Per l'area vengono registrati prima l'angolo superiore sinistro e poi quello inferiore destro.

## Rilevamento fine rendering

Dopo il click sulla pagina successiva Ebook2PDF:

1. attende il ritardo minimo configurato;
2. verifica che l'immagine sia cambiata rispetto alla pagina precedente;
3. acquisisce frame successivi;
4. considera pronta la pagina quando la differenza resta sotto la soglia per il numero configurato di conferme consecutive.

A differenza dell'estensione, la versione desktop non può usare `document.readyState`, `aria-busy`, font, immagini DOM, overlay o `MutationObserver`, perché lavora sullo schermo e non sul DOM del browser.

## Modalità Tutte

Nell'estensione la fine del documento può essere rilevata quando il controllo DOM "pagina successiva" scompare.

La versione desktop usa invece questa regola:

> se, dopo tutti i tentativi configurati, i click sul punto "pagina successiva" non producono un cambiamento visivo sufficiente, il documento viene considerato terminato.

Questo rende la modalità **Tutte** utilizzabile anche su viewer che non espongono alcuna API o struttura DOM accessibile allo script.

## OCR

Il flusso OCR usa direttamente l'eseguibile Tesseract locale.

Parametri disponibili:

- lingua: `ita`, `eng`, `ita+eng`;
- PSM: 3, 4, 6, 11;
- `preserve_interword_spaces`;
- upscale da 1× a 3×;
- percorso eseguibile Tesseract.

La pipeline è:

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

L'upscale viene compensato impostando un DPI proporzionale, così il layer testuale mantiene le dimensioni della pagina originale.

Se Tesseract non è disponibile o una pagina OCR fallisce, le immagini acquisite non vengono perse: viene comunque prodotto il PDF e vengono applicati i layer OCR disponibili.

## Configurazione persistente

I parametri vengono salvati in:

```text
~/.ebook2pdf/config.json
```

Sono persistenti:

- numero pagine e modalità Tutte;
- ritardi e retry;
- timeout rendering;
- intervallo e soglie di stabilità;
- controllo duplicati/cambio pagina;
- impostazioni OCR;
- percorso Tesseract;
- ultima cartella di output.

L'area di cattura e il punto di avanzamento non vengono salvati perché dipendono dalla posizione del viewer sullo schermo.

## Architettura

```text
ebook2pdf.py                 launcher

ebook2pdf_app/
├── __init__.py
├── settings.py              configurazione persistente
├── capture.py               screenshot, click e confronto immagini
├── render.py                cambio pagina e stabilità visiva
├── ocr.py                   Tesseract locale / PDF text-only
├── pdf.py                   composizione PDF con PyMuPDF
└── gui.py                   interfaccia Tkinter + worker thread
```

Acquisizione, OCR e composizione PDF vengono eseguiti fuori dal thread Tkinter, così la GUI resta responsiva e il pulsante **Ferma** può interrompere in modo controllato il flusso.

## Uso autorizzato

Usare Ebook2PDF esclusivamente per documenti di cui si possiede il diritto o l'autorizzazione alla copia. La versione desktop opera solo sui pixel visibili sullo schermo e non implementa rimozione DRM, decifratura o recupero di risorse nascoste.
