<p align="center">
  <img src="extension/icons/icon128.png" alt="Ebook2PDF" width="128">
</p>

<h1 align="center">Ebook2PDF</h1>

<p align="center">
  Acquisisce le pagine visibili di ebook e documenti web autorizzati e le raccoglie in un PDF locale.<br>
  Disponibile come <strong>script Python</strong> oppure come <strong>estensione per browser Chromium</strong> con OCR locale opzionale.
</p>

<p align="center">
  <strong>Autore:</strong> Prof. Adriani · <a href="https://github.com/il-prof-f-a">@il-prof-f-a</a><br>
  <strong>Repository:</strong> <a href="https://github.com/il-prof-f-a/ebook2pdf-python">github.com/il-prof-f-a/ebook2pdf-python</a>
</p>

> [!IMPORTANT]
> Ebook2PDF è pensato per documenti di cui si possiede il diritto o l'autorizzazione alla copia. Non implementa rimozione DRM, decifratura, recupero di contenuti nascosti o accesso a risorse non visibili all'utente.

---

## Due modalità di utilizzo

| | Script Python | Estensione browser |
|---|---|---|
| Ambiente | Windows/desktop | Chrome, Edge, Brave e browser Chromium compatibili |
| Selezione area | coordinate schermo | selezione grafica nel browser |
| Pagina successiva | coordinate del mouse | elemento DOM selezionato dall'utente |
| Numero pagine | numero definito | numero definito oppure **Tutte** |
| Fine documento automatica | no | sì, quando il comando avanti non è più disponibile |
| Controllo rendering | retry + controlli immagine | stabilità visiva + segnali DOM |
| OCR | esterno/manuale | **Tesseract.js locale opzionale** |
| PDF ricercabile | con post-elaborazione | integrato |
| Configurazione | console | pannello laterale + impostazioni persistenti |

Per un utilizzo normale nel browser è consigliata l'**estensione**. Lo script Python resta utile come soluzione semplice, indipendente dal DOM del portale e facilmente modificabile.

---

# Estensione browser

## Funzioni principali

L'estensione Ebook2PDF utilizza Manifest V3 e lavora interamente nel browser. Permette di:

- selezionare graficamente l'area della pagina da acquisire;
- scegliere direttamente il controllo usato dal viewer per passare alla pagina successiva;
- gestire pulsanti, link, componenti custom e controlli basati su SVG;
- acquisire un numero prestabilito di pagine oppure scegliere **Tutte**;
- attendere il completamento del rendering prima della cattura;
- verificare che la nuova pagina sia realmente diversa dalla precedente;
- usare segnali DOM come `document.readyState`, font caricati, immagini complete, `aria-busy`, loader e quiete delle mutazioni;
- usare anche la stabilità visiva tra screenshot consecutivi;
- mantenere la nitidezza come diagnostica senza scartare automaticamente una pagina già stabilizzata;
- creare PDF multipagina completamente in locale;
- aggiungere OCR locale con Tesseract.js;
- produrre PDF ricercabili e selezionabili usando il renderer PDF nativo di Tesseract;
- scegliere lingua OCR, PSM e ingrandimento dell'immagine usata dal riconoscimento;
- conservare le impostazioni in `chrome.storage.local`.

## Installazione dell'estensione

### 1. Scarica il repository

Con Git:

```bash
git clone https://github.com/il-prof-f-a/ebook2pdf-python.git
cd ebook2pdf-python
```

Se stai provando l'estensione prima che il branch dedicato venga integrato nel ramo principale:

```bash
git checkout browser-extension
```

In alternativa puoi scaricare il repository come ZIP da GitHub ed estrarlo in una cartella locale.

### 2. Carica l'estensione nel browser

Apri la pagina delle estensioni:

- Chrome: `chrome://extensions/`
- Edge: `edge://extensions/`
- Brave: `brave://extensions/`

Poi:

1. attiva **Modalità sviluppatore**;
2. scegli **Carica estensione non pacchettizzata** / **Load unpacked**;
3. seleziona la cartella `extension/` del repository;
4. opzionalmente fissa Ebook2PDF nella barra degli strumenti del browser.

L'icona blu di Ebook2PDF comparirà tra le estensioni installate.

### 3. Asset OCR

Gli asset runtime correnti di Tesseract.js, Tesseract Core, i modelli `ita`/`eng` e `pdf-lib` sono inclusi nella cartella `extension/`.

Se devi rigenerarli o aggiornarli, dalla root del repository puoi usare gli script predisposti. Su Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\extension\scripts\install-tesseract-assets.ps1
```

Su Linux, macOS o Git Bash:

```bash
bash ./extension/scripts/install-tesseract-assets.sh
```

Gli script richiedono Node.js/npm. Dopo aver aggiornato gli asset premi **Ricarica** nella pagina delle estensioni.

## Come usare l'estensione

1. Apri l'ebook o il documento web e posizionati sulla prima pagina da acquisire.
2. Apri Ebook2PDF dalla sua icona: compare il pannello laterale.
3. Scegli quante pagine acquisire oppure abilita **Tutte**.
4. Premi **Seleziona area pagina** e trascina il rettangolo sull'area del documento da includere.
5. Premi **Seleziona pulsante avanti** e clicca il controllo che porta alla pagina successiva.
6. Se vuoi un PDF ricercabile, abilita **OCR locale**.
7. Apri ⚙️ **Impostazioni** se vuoi modificare rendering, retry, segnali DOM, PSM, lingua o upscale OCR.
8. Premi **Avvia acquisizione**.

Con la modalità **Tutte**, Ebook2PDF continua finché il comando "pagina successiva" non è più disponibile. In quel momento chiude l'acquisizione e passa automaticamente all'OCR e alla creazione del PDF.

Se il comando avanti rimane presente ma la pagina non cambia dopo tutti i tentativi configurati, l'acquisizione viene interrotta per evitare duplicati o sequenze sfasate.

## Rilevamento del completamento della pagina

La nitidezza non è più il criterio principale per decidere se una pagina è pronta. Dopo ogni cambio pagina l'estensione combina due gruppi di segnali:

**Stabilità visiva**

- verifica che l'area sia cambiata rispetto alla pagina precedente;
- confronta screenshot successivi della stessa area;
- considera stabile la pagina dopo il numero configurato di conferme consecutive.

**Segnali DOM**

- `document.readyState`;
- stato dei font;
- immagini visibili ancora incomplete;
- elementi visibili con `aria-busy="true"`;
- loader/spinner/loading visibili;
- tempo trascorso dall'ultima mutazione DOM rilevante nell'area acquisita.

Se un portale non espone segnali DOM utili, Ebook2PDF continua usando la stabilità visiva.

Dettagli tecnici: [`extension/RENDER_READINESS.md`](extension/RENDER_READINESS.md).

## OCR locale e PDF ricercabile

L'OCR viene eseguito con Tesseract.js direttamente nel browser, senza inviare le pagine a servizi OCR esterni.

Pipeline:

```text
JPEG originale
    ├──────────────→ immagine visibile nel PDF finale
    │
    └→ upscale OCR configurabile
          ↓
       Tesseract.js
          ↓
   PDF text-only nativo
          ↓
        pdf-lib
          ↓
JPEG originale + layer Tesseract
          ↓
PDF ricercabile e selezionabile
```

Il PDF visibile conserva quindi l'immagine acquisita dal browser, mentre spaziatura, baseline e geometria del testo OCR sono gestiti direttamente dal renderer PDF di Tesseract.

Approfondimenti: [`extension/OCR_TUNING.md`](extension/OCR_TUNING.md).

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

# Script Python

Lo script originale `ebook2pdf.py` automatizza la cattura dello schermo tramite coordinate del mouse. Non richiede l'installazione di un'estensione browser ed è utile quando il viewer non è facilmente gestibile tramite DOM.

## Dipendenze

Installa Python e poi:

```bash
pip install pyautogui pillow numpy
```

Lo script utilizza:

- `pyautogui` per coordinate e click;
- Pillow / `ImageGrab` per screenshot e PDF;
- NumPy per la stima della nitidezza.

## Avvio

Dalla cartella del repository:

```bash
python ebook2pdf.py
```

La procedura guidata chiede:

1. numero di pagine;
2. ritardo tra cambio pagina e cattura;
3. angolo superiore sinistro dell'area da acquisire;
4. angolo inferiore destro;
5. posizione del comando pagina successiva;
6. percorso del PDF di uscita.

Una volta iniziata l'acquisizione, lo script cattura la regione scelta, controlla duplicati e qualità dell'immagine, esegue i retry previsti e crea il PDF con le pagine valide.

A differenza dell'estensione, lo script non integra l'OCR locale: se serve testo ricercabile è necessario effettuare un passaggio OCR successivo con uno strumento a propria scelta.

---

## Struttura del progetto

```text
ebook2pdf-python/
├── ebook2pdf.py                 # script Python originale
├── README.md
└── extension/                   # estensione Chromium
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
    │   ├── icon16.png
    │   ├── icon32.png
    │   ├── icon48.png
    │   └── icon128.png
    ├── lib/
    │   ├── tesseract/
    │   ├── tesseract-core/
    │   └── pdf-lib/
    ├── tessdata/
    └── scripts/
```

## Aggiornare l'estensione dopo un `git pull`

Dopo aver aggiornato il repository:

```bash
git pull
```

apri nuovamente `chrome://extensions/` e premi **Ricarica** sulla scheda di Ebook2PDF. Non è necessario rimuovere e reinstallare l'estensione.

---

## Limiti noti

- l'acquisizione riguarda solo ciò che è visibile e renderizzato nella scheda;
- iframe cross-origin e alcuni viewer possono impedire l'accesso al comando pagina successiva;
- documenti molto lunghi, soprattutto con OCR e upscale elevato, possono richiedere molta RAM;
- la qualità OCR dipende da risoluzione, contrasto, font e layout della pagina;
- nessun sistema automatico può garantire compatibilità con ogni viewer web: i controlli avanzati sono configurabili proprio per adattarsi a comportamenti differenti.

## Privacy

Screenshot, OCR e composizione PDF vengono eseguiti localmente dal browser. Ebook2PDF non richiede API cloud per l'OCR e non invia intenzionalmente le pagine a servizi esterni.

## Nota legale ed etica

Utilizza Ebook2PDF esclusivamente con contenuti per i quali disponi dei diritti o di una esplicita autorizzazione alla copia e all'uso offline. Rispetta copyright, licenze d'uso e condizioni di servizio della piattaforma che ospita il documento.
