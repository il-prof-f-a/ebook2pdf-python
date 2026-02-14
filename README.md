## 🧩 Dipendenze

Installa le librerie necessarie con:

```bash
pip install pyautogui pillow numpy
```

> Su Windows, `pyautogui` potrebbe richiedere moduli aggiuntivi (es. `pyscreeze`), ma `pip` li gestisce in automatico.

Lo script usa:

- `pyautogui` per leggere la posizione del mouse e fare i click,
- `Pillow (PIL)` per le immagini e la creazione del PDF,
- `numpy` per stimare la nitidezza (sharpness) delle immagini,
- `ImageGrab` per catturare screenshot dell’area definita.

---

## ▶️ Utilizzo

1. **Apri il documento** in un browser (solo contenuti di cui hai il pieno diritto di copia).
2. Porta la pagina alla dimensione desiderata e **posiziona la copertina** dentro l’area che vorrai catturare.
3. Avvia lo script Python, ad esempio:

   ```bash
   python ebook2pdf.py
   ```

4. Segui la procedura guidata in console:
   - inserisci il **numero di pagine** da acquisire,
   - inserisci il **ritardo minimo** tra cambio pagina e cattura (in secondi),
   - seleziona con il mouse:
     - l’angolo **superiore sinistro** dell’area da catturare,
     - l’angolo **inferiore destro** dell’area da catturare,
   - seleziona il punto in cui cliccare per andare alla **pagina successiva**,
   - scegli (o conferma) il **percorso del PDF** di uscita.

5. Quando lo script te lo chiede, assicurati di essere sulla **copertina**, poi premi INVIO in console.

Da lì in poi lo script:
- cattura la prima pagina,
- salva l’immagine in memoria,
- clicca sul punto “pagina successiva”,
- aspetta il tempo indicato,
- ripete il ciclo finché non raggiunge il numero di pagine richiesto (o finché una serie di errori non forza uno stop anticipato).

---

## 🧠 Logica di robustezza

Per ogni pagina:

1. Attende il tempo minimo indicato (ed eventualmente 1 secondo aggiuntivo ad ogni ritentativo).
2. Cattura l’area di schermo definita.
3. Controlla che l’immagine **non sia identica** alla precedente.
4. Ricava i due riquadri di verifica:
   - alto-sinistra,
   - basso-destra,
   entrambi grandi metà larghezza × metà altezza dell’area catturata.
5. Per ognuno dei due riquadri:
   - controlla se è **monocolore** → in tal caso la pagina viene considerata “non caricata” e si ritenta;
   - misura una stima di **nitidezza** (calcolata con il gradiente).
6. Confronta la nitidezza (prende il minimo tra i due riquadri) con quella della **prima pagina valida**, che viene usata come **baseline**.
7. Se la nitidezza è troppo inferiore alla baseline:
   - in genere la pagina viene considerata **sgranata** e si ritenta;
   - **ma** se è la **prima** o l’**ultima** pagina del blocco richiesto, l’immagine viene comunque accettata.

Dopo **5 tentativi falliti** sulla stessa pagina:
- la pagina viene **segnata come “saltata”**,
- lo script prosegue con le successive,
- il PDF finale viene creato comunque con ciò che è stato acquisito correttamente.

---

## 🧩 Post-elaborazione consigliata

Una volta creato il PDF, è una buona idea fare **due passaggi manuali**:

### 1. Controllo e rimozione di pagine duplicate

Durante la cattura può capitare che:
- l’ultima pagina venga acquisita più volte,
- qualche pagina venga ripetuta per via di rallentamenti nel caricamento.

Per sistemare il PDF:

1. Apri il PDF generato con uno strumento di organizzazione.
2. Elimina:
   - le pagine evidentemente duplicate,
   - eventuali pagine con caricamento palesemente incompleto.

Strumento consigliato (online):

- **Organizzare / riordinare / eliminare pagine PDF**:  
  https://www.ilovepdf.com/it/organizzare-pdf

Con questo servizio puoi:
- vedere tutte le pagine in miniatura,
- trascinare per cambiare ordine,
- cancellare le duplicate,
- risalvare un PDF “pulito”.

---

### 2. Estrarre il testo via OCR

Se il PDF contiene solo immagini (screenshot delle pagine), per poter cercare e copiare il testo ti serve un passaggio di **OCR** (riconoscimento ottico dei caratteri).

Strumento consigliato (online):

- **OCR su PDF (trasforma immagini in testo ricercabile)**:  
  https://tools.pdf24.org/en/ocr-pdf

Passaggi tipici:

1. Carica il PDF “pulito” (già ripulito da pagine duplicate).
2. Seleziona la lingua corretta (es. italiano).
3. Avvia l’OCR.
4. Scarica il **nuovo PDF**:
   - il contenuto sarà ancora visivamente identico,
   - ma sotto le immagini ci sarà un layer di testo ricercabile e selezionabile.

In questo modo ottieni un PDF:
- con la **struttura grafica** del documento originale,
- ma **usabile**: ci puoi fare ricerche per parola, copia/incolla, indicizzazione ecc.

---

## 🔐 Nota legale / etica

Usa questo script **solo** per:

- documenti di cui sei **titolare dei diritti**, oppure
- documenti per cui hai ottenuto **esplicito permesso** alla copia e all’uso offline.

Evita di violare:
- copyright,
- licenze d’uso,
- condizioni di servizio delle piattaforme su cui il documento è ospitato.

---

## 💡 Suggerimenti futuri (facoltativi)

Possibili estensioni:

- Aggiungere una modalità **“debug”** che salva i due riquadri di controllo su disco per analizzarli.
- Loggare su file:
  - la nitidezza rilevata per ogni pagina,
  - le pagine saltate e il motivo (monocolore, duplicata, sgranata).
- Creare una piccola **GUI** (es. con Tkinter) per evitare l’interazione da console.

Flusso consigliato riassunto:

1. Catturi con lo script → ottieni `documento_raw.pdf`
2. Rimuovi/riordini pagine → ottieni `documento_pulito.pdf`
3. Esegui OCR → ottieni `documento_ricercabile.pdf`

così puoi portarti sempre dietro una versione offline, comoda e consultabile.

