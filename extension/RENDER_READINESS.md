# Rilevamento fine rendering pagina

Dalla versione 0.6.0 Ebook2PDF non usa più la nitidezza come criterio principale per decidere se una pagina è pronta.

## Strategia

Dopo il comando "pagina successiva" vengono usati due gruppi di segnali.

### 1. Stabilità visiva

1. viene verificato che l'area acquisita sia cambiata rispetto alla pagina precedente;
2. vengono eseguite catture successive della stessa area;
3. la pagina è considerata visivamente stabile quando più confronti consecutivi rimangono sotto la soglia configurata.

Valori predefiniti:

- soglia cambio pagina: `0,20%`;
- soglia stabilità: `0,15%`;
- conferme consecutive: `2`;
- intervallo configurato: `0,4 s`;
- le catture vengono comunque serializzate dal background con almeno `500 ms` tra due screenshot.

### 2. Segnali DOM

Quando attivi, il content script controlla nell'area selezionata:

- `document.readyState === "complete"`;
- stato di `document.fonts`;
- immagini visibili non ancora complete;
- elementi visibili con `aria-busy="true"`;
- elementi visibili che sembrano loader/spinner/loading;
- tempo trascorso dall'ultima mutazione DOM rilevante nell'area acquisita.

La quiete DOM predefinita è `500 ms`.

## Timeout

Il tempo massimo di attesa rendering è configurabile e vale `12 s` per impostazione predefinita.

Se la pagina è realmente cambiata ma non soddisfa tutti i segnali entro il timeout, Ebook2PDF acquisisce comunque l'ultimo frame disponibile e scrive un avviso nel log.

Se invece il contenuto non cambia dopo il click, Ebook2PDF ripete il comando "pagina successiva" fino al numero massimo di tentativi. Se non rileva comunque il cambio, interrompe l'acquisizione senza saltare la pagina, così il PDF non perde la corrispondenza con la sequenza originale.

## Nitidezza

Il controllo di nitidezza resta disponibile come diagnostica. La prima pagina acquisita definisce la baseline e il ratio configurabile viene ancora calcolato, ma una pagina già considerata renderizzata non viene più scartata soltanto perché la sua nitidezza è inferiore alla soglia.

Questo evita falsi negativi su pagine correttamente renderizzate ma con grafica, font o contrasto naturalmente differenti.