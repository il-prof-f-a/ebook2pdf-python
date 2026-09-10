# Rilevamento fine rendering pagina

Dalla versione 0.9.0 Ebook2PDF determina la disponibilità della pagina osservando **come il contenuto converge nel tempo**, senza confrontarlo con una soglia assoluta ricavata da altre pagine.

## Strategia

Dopo il comando "pagina successiva" la validazione segue questa sequenza:

1. verifica del cambio rispetto alla pagina precedente;
2. osservazione di più frame della nuova pagina;
3. convergenza temporale degli indicatori visivi;
4. esclusione di placeholder di caricamento evidenti;
5. controllo di overlay, loader e segnali DOM;
6. acquisizione del frame validato.

### 1. Cambio pagina

L'area deve differire dalla pagina precedente almeno della soglia configurata. Il valore predefinito è `0,20%`.

Se il cambiamento non viene rilevato, Ebook2PDF riprova il comando di avanzamento fino al numero massimo di tentativi configurato.

### 2. Convergenza temporale

La pagina non viene giudicata in base al valore assoluto di un singolo indicatore. Per ogni screenshot vengono invece confrontati con il frame precedente:

- differenza media dei pixel;
- energia dei bordi;
- contrasto globale;
- distribuzione della luminanza.

La pagina deve rimanere convergente per almeno **3 controlli consecutivi**. Il numero può essere aumentato nelle impostazioni.

Valori predefiniti:

- soglia cambio pagina: `0,20%`;
- soglia stabilità pixel: `0,15%`;
- conferme consecutive: `3`;
- intervallo: `0,4 s`;
- attesa minima dopo il cambio pagina: `1,5 s`.

Le catture vengono inoltre serializzate dal background con almeno `500 ms` tra due screenshot.

### 3. Placeholder di caricamento

Viene usato un controllo prudente per intercettare schermate temporanee tipiche dei viewer: grande area grigia quasi uniforme con un piccolo indicatore concentrato al centro.

Il segnale non viene confrontato con pagine precedenti e serve soltanto a evitare che una schermata di attesa stabile venga scambiata per una pagina completata.

### 4. Segnali DOM e overlay

Solo dopo la convergenza visiva il content script controlla nell'area selezionata:

- `document.readyState === "complete"`;
- stato di `document.fonts`;
- immagini visibili non ancora complete;
- `aria-busy`, progress bar, loader, spinner e skeleton;
- elementi animati riconducibili al caricamento;
- cursori CSS `wait` o `progress`;
- overlay posizionati sopra una porzione significativa dell'area;
- filtri CSS/backdrop con offuscamento;
- tempo trascorso dall'ultima mutazione DOM rilevante.

La quiete DOM predefinita è `500 ms`.

## Timeout e attesa estesa dei loader

Il tempo massimo ordinario di attesa è configurabile e vale `12 s` per impostazione predefinita.

Durante l'attesa Ebook2PDF conserva il miglior candidato osservato. Se la parte visiva è convergente e non risultano blocker espliciti, il candidato può essere usato come fallback al timeout.

Dalla versione 0.9.1 il timeout ordinario **non interrompe più l'acquisizione quando la pagina risulta ancora esplicitamente in caricamento**. Se allo scadere del timeout sono ancora presenti loader/busy, immagini incomplete, overlay sospetti, indicatori animati, filtri di offuscamento, cursori di attesa o un placeholder centrale di caricamento, Ebook2PDF rinnova il periodo di attesa e rimane sulla stessa pagina.

In questa situazione non viene eseguito un nuovo click sulla pagina successiva e non si passa a OCR/PDF. L'attesa continua finché il blocker scompare e la pagina raggiunge nuovamente i criteri di convergenza. L'utente può sempre interrompere volontariamente l'attesa con **Ferma**.

Se invece il timeout scade senza alcun segnale esplicito di caricamento e nessun frame raggiunge una condizione affidabile, la pagina corrente non viene forzata: l'errore è considerato recuperabile e Ebook2PDF prosegue con OCR e PDF delle pagine già raccolte.

## Perché questo approccio

Pagine graficamente diverse possono avere valori assoluti molto differenti pur essendo perfettamente renderizzate. Il confronto temporale evita quindi di usare una pagina come riferimento per le altre e cerca invece il momento in cui **la singola pagina smette realmente di evolvere**.
