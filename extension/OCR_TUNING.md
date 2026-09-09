# OCR: qualità, layout e PDF nativo

Dalla versione 0.5.0 Ebook2PDF usa direttamente il **renderer PDF di Tesseract** per il layer testuale.

## Pipeline

```text
JPEG originale
    ├──────────────→ immagine visibile finale
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
```

Questo evita la ricostruzione manuale del testo tramite bounding box, font Helvetica e posizionamento parola-per-parola.

## Upscale OCR

Tesseract lavora spesso meglio con testo piccolo se l'immagine viene ingrandita prima del riconoscimento. Ebook2PDF permette:

- 1×;
- 1,5×;
- 2× — predefinito;
- 2,5×;
- 3×.

L'immagine ingrandita serve **solo** a Tesseract. Nel PDF finale viene riutilizzato il JPEG originale.

Per mantenere il layer text-only perfettamente allineato, il DPI passato a Tesseract viene moltiplicato per lo stesso fattore dell'upscale.

## Spazi tra parole

Per impostazione predefinita viene applicato:

```text
preserve_interword_spaces=1
```

È possibile disattivarlo dalle impostazioni OCR.

Con il renderer PDF nativo non è più Ebook2PDF a dedurre la distanza fra parole: spazi, baseline e posizionamento sono responsabilità di Tesseract.

## Page Segmentation Mode (PSM)

### PSM 3 — Automatico

Predefinito e consigliato per pagine di libri con testo, titoli, riquadri, immagini e zone differenti.

### PSM 4 — Colonna singola

Può migliorare pagine organizzate prevalentemente come una singola colonna di testo.

### PSM 6 — Blocco uniforme

Indicato quando l'area acquisita contiene sostanzialmente un solo blocco di testo, ad esempio un riquadro isolato. Usarlo su una pagina complessa può peggiorare l'ordine di lettura.

### PSM 11 — Testo sparso

Utile quando il testo è distribuito in zone separate e non è importante imporre una struttura di lettura molto rigida.

## Strategia consigliata

Per un normale libro scolastico partire con:

```text
PSM 3
preserve_interword_spaces = attivo
upscale OCR = 2×
```

Cambiare PSM soltanto se uno specifico libro presenta un layout ricorrente che viene segmentato male.

Se il testo è molto piccolo, provare prima 2,5× o 3×; questo aumenta però tempi e memoria.

## PDF text-only

Tesseract viene chiamato con output PDF e opzione equivalente a `textonly_pdf=1`. Il suo PDF contiene il layer OCR ma non l'immagine. Ebook2PDF copia quella pagina in un nuovo documento e vi aggiunge il JPEG catturato.

Il vantaggio è che il documento mantiene l'immagine esatta acquisita dal browser, mentre ricerca, selezione e copia del testo sono basate sulla geometria prodotta direttamente da Tesseract.

## Possibili sviluppi successivi

Se alcune pagine restano problematiche, la strategia successiva consigliata è un **secondo passaggio selettivo** su regioni a bassa confidenza, usando un PSM diverso per il singolo riquadro invece di cambiare il PSM dell'intera pagina.