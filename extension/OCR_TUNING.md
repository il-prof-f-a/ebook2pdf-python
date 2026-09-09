# OCR: struttura, spazi e segmentazione

Dalla versione 0.4.0 Ebook2PDF non usa più l'output OCR come semplice lista di parole indipendenti.

## Pipeline

Tesseract restituisce una struttura gerarchica:

```text
block
└── paragraph
    └── line
        └── word
```

Ebook2PDF conserva questa struttura e genera il text layer PDF per **righe complete**. In questo modo gli spazi riconosciuti restano dentro una singola stringa PDF e non devono essere dedotti dal lettore PDF in base alla distanza tra parole separate.

I frammenti che Tesseract colloca sulla stessa riga vengono ricomposti soltanto se appartengono allo stesso blocco e allo stesso paragrafo e hanno una forte sovrapposizione verticale. Questo evita, per quanto possibile, di unire colonne o riquadri differenti.

## Spazi tra parole

Per impostazione predefinita viene applicato:

```text
preserve_interword_spaces=1
```

È possibile disattivarlo dalle impostazioni OCR.

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

Per un libro scolastico normale partire con:

```text
PSM 3
preserve_interword_spaces = attivo
```

Cambiare PSM soltanto se uno specifico libro presenta un layout ricorrente che viene segmentato male.

## Nota sul PDF

L'immagine della pagina resta invariata. Il testo OCR viene aggiunto come layer invisibile e serve soltanto per ricerca, selezione e copia. La qualità della selezione dipende quindi sia dal riconoscimento Tesseract sia dalla qualità della segmentazione delle righe.