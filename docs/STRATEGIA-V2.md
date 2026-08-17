# Spapple V2 — documento strategico

**17 agosto 2026.** Sostituisce la bozza della stessa data, la cui premessa è stata
falsificata durante la revisione. La versione precedente è conservata in
`~/.gstack/projects/simoneattana-SPAPPLE/main-autoplan-restore-20260817-025542.md`.

---

## 0. La premessa, decisa

**Spapple è un sistema che vale la pena costruire bene. Il rendimento è il metro di
realtà, non l'obiettivo.**

Questo cambia il criterio di successo. Non è «la strategia guadagna». È **«il
simulatore dice la verità»**: quando Spapple mostra un numero, quel numero deve
significare quello che sembra significare, e dove non può significarlo deve dirlo.

Tutto il resto del documento discende da qui.

## 1. Cosa dicono davvero i 25 trade

La bozza precedente sosteneva che il segnale RSI avesse prodotto un vantaggio lordo di
+0,113% per operazione. È falso, e il modo in cui è falso è istruttivo.

Le 25 operazioni non sono 25 osservazioni indipendenti. Sono **8 giornate**:

| Mercato | Giorno | Operazioni | Risultato lordo medio |
|---|---|---|---|
| asia | 2026-08-03 | 13 | **+0,625%** |
| asia | 2026-07-17 | 3 | +0,302% |
| equities | 2026-07-16 | 1 | +1,383% |
| equities | 2026-07-22 | 1 | −1,601% |
| equities | 2026-08-02 | 2 | −0,234% |
| usa | 2026-07-20 | 2 | −1,413% |
| usa | 2026-07-23 | 2 | −1,269% |
| usa | 2026-08-02 | 1 | −0,154% |

Il 3 agosto sull'Asia sono 13 short su Hong Kong e Tokyo aperti nello stesso giro di
poche ore. Non sono tredici scommesse: è una scommessa sola, su un movimento di
mercato correlato.

```
media per operazione, tutte e 25            +0,113%
media per operazione, senza il 3 agosto     −0,442%
media per giornata, trattando ogni
giornata come una sola osservazione         −0,295%

quel solo giorno vale il 52% del campione
e contribuisce il 287% del risultato lordo
```

**Non esiste evidenza di un vantaggio.** Esiste una giornata fortunata che, contata
tredici volte, faceva sembrare positivo un insieme che positivo non è.

Questo non è un fallimento della strategia. È il campione che è troppo piccolo per
dire qualunque cosa, e che va letto per quello che è.

## 2. Perché quei numeri non possono migliorare da soli

Anche raccogliendo dieci volte più operazioni, quattro difetti strutturali
impedirebbero di trarne una conclusione. Vanno conosciuti adesso, non riscoperti fra
sei mesi come se fossero novità.

### Le barre sono giornaliere, le uscite sono infragiornaliere

Tutte le fonti scaricano un prezzo al giorno: `interval=1d` su Yahoo,
l'endpoint `eod` su EODHD, `1440` minuti su Kraken. Ma le uscite del motore vivono
dentro la seduta: protezione alle 17:10, trailing sui massimi intraday, chiusura
finale alle 17:20.

Conseguenza: **qualunque simulazione storica costruita su questi dati non può
riprodurre le uscite del motore.** Non è un dettaglio da sistemare, è una fonte dati
diversa e a pagamento.

### Il P/E è quello di oggi

Il filtro di ammissione richiede P/E positivo, e il P/E arriva dal fornitore come
valore corrente. In una simulazione storica significa decidere gli ingressi del 2024
sapendo i bilanci del 2026. È la forma più classica di sguardo nel futuro, e da sola
basta a produrre curve convincenti e false.

### L'universo è la lista dei sopravvissuti

Gli 80 titoli europei, 120 americani e 80 asiatici sono la lista di oggi. Chi è stato
delistato, fuso o è fallito non c'è. Una simulazione su quella lista misura come
sarebbe andata scegliendo solo aziende che sappiamo essere ancora vive.

### Metà del costo è un numero senza fonte

`SLIPPAGE_ATR_RATIO = 0.05` sta alla prima riga di `executionCosts.js`, senza commento
e senza fonte. Vale il **55% del costo totale modellato sugli USA** e il 48% su Xetra.

E non è verificabile: in simulazione non esistono eseguiti veri con cui confrontarlo.
Resta un'ipotesi che determina metà del risultato. Va trattata come tale, in modo
visibile, non nascosta dentro una costante.

## 3. Cosa vuol dire costruirlo bene

Un simulatore è fatto bene quando **quello che mostra corrisponde a quello che
sarebbe successo**, e quando dichiara i punti in cui non può saperlo.

Oggi Spapple fallisce questo criterio in tre punti: mostra un P&L calcolato con
commissioni di un broker che non usi, con uno slittamento inventato, e senza mai dire
quante osservazioni ci sono dietro un numero. Il lavoro del 16 e 17 agosto ne ha
sistemati altri quattro: motore in copia unica, direzione del segnale corretta, blocchi
che scadono, calendario di borsa reale.

Il criterio di completamento della V2 è questo: **ogni numero che Spapple mostra è
accompagnato da cosa lo rende vero o incerto.**

## 4. La rotta

### Fase A — Il modello costi smette di mentire

È la prima perché tutto il resto ci poggia sopra.

1. Sostituire il listino Directa con **IBKR Pro Tiered**, con la fonte annotata accanto
   a ogni numero: Europa 0,05% con minimo 1,25 €, USA 0,0035 $/azione con minimo 0,35 $,
   Hong Kong minimo 18 HKD, Tokyo 0,05% con minimo 80 JPY.
2. Aggiungere il **termine di cambio valuta**, oggi assente: 0,002% con minimo 2 USD per
   lato in conversione manuale, 0,03% in automatica. Sotto i 3.000 € il minimo domina, e
   va visto.
3. Aggiungere le **imposte di stato**: Tobin italiana sugli acquisti, bollo di Hong Kong
   su entrambi i lati, imposta cinese sulle vendite. Sono la parte del costo che nessuna
   scelta di broker può ridurre.
4. Aggiungere il **prestito titoli** per gli short. Oggi assente, e 22 operazioni su 25
   erano short.
5. Rendere lo **slittamento un parametro dichiarato**, non una costante nascosta: con la
   sua fonte, o l'ammissione che non ne ha una, e la possibilità di vedere quanto cambia
   il risultato al variare di quel numero.

Effetto atteso sul costo di un giro completo, dalla misura attuale di 0,850%:

| Borsa | Costo modellato | di cui slittamento |
|---|---|---|
| USA | 0,274% | 55% |
| Xetra | 0,310% | 48% |
| Svizzera | 0,377% | 40% |
| Milano | 0,410% | 37% |
| Tokyo | 0,410% | 37% |
| Hong Kong | 0,642% | 23% |

### Fase B — L'interfaccia dice cosa sono i numeri

Un P&L senza il numero di osservazioni dietro è una bugia per omissione. Servono, dove
i numeri si vedono:

- la numerosità del campione accanto a ogni statistica aggregata
- il conteggio delle **giornate** oltre a quello delle operazioni, perché è la
  numerosità vera
- una riga che dice che il risultato è simulato, con quale modello costi, e che lo
  slittamento è un'ipotesi
- l'indicazione di quali distorsioni sono presenti quando si guarda uno storico

Non è una funzionalità decorativa: è la parte che impedisce di ri-ingannarsi, ed è
esattamente l'errore che ho commesso io scrivendo la prima bozza di questo documento.

### Fase C — Rimettere in moto, in modalità osservazione

Il motore è pronto per ripartire: direzione corretta, blocchi che scadono, calendario
vero, 87 test. Ma riaccenderlo per aprire posizioni produce altre giornate correlate e
nessuna conoscenza.

Meglio la **modalità osservazione**: il motore scansiona, registra i segnali che avrebbe
aperto con prezzo e ora, e annota cosa succede a +1 ora, +1 giorno, +3 giorni,
+1 settimana. Non apre niente.

Costa poco da costruire, non rischia nulla, e produce la distribuzione dei rendimenti
per orizzonte, che è l'unico dato che rende sensata una futura discussione sulla
geometria. Nel frattempo l'app torna viva e ha qualcosa da mostrare.

### Fase D — Il banco di prova, con i limiti dichiarati in partenza

Una simulazione storica resta un buon pezzo di ingegneria da costruire, e il motore ora
è in condizione di reggerla. Va costruita sapendo cosa **non** potrà dire:

- niente uscite infragiornaliere, finché i dati sono giornalieri
- niente conclusioni sul filtro P/E, finché i fondamentali non sono storici
- niente conclusioni sull'universo, finché contiene solo sopravvissuti

Con quei limiti scritti nel risultato, resta uno strumento utile. Senza, è una macchina
per prodursi conferme.

Una prova che vale più di mille ottimizzazioni: far girare accanto alla strategia dei
**controlli banali** — ingressi casuali con la stessa distribuzione di orari e durate,
inversione del rendimento del giorno prima, il segnale invertito, RSI senza filtro P/E.
Se la strategia non li batte, la geometria non è il problema.

### Fase E — Le parti mai finite

Il crypto ha `enabled: false` da sempre: zero scansioni, zero ordini, regole scritte e
mai eseguite. O si accende e si osserva, o si toglie. Restare in mezzo significa
mantenere codice che non fa niente.

## 5. Le regole contro l'auto-inganno

Tre, e valgono più di qualunque scelta tecnica di questo documento.

1. **Un numero senza numerosità non si mostra.** Vale per l'interfaccia e vale per le
   conversazioni: se scrivo «la strategia rende X», devo scrivere accanto su quante
   giornate indipendenti.
2. **Le giornate contano, non le operazioni.** Tredici posizioni aperte nello stesso
   giro sulla stessa area sono un dato solo.
3. **Chi propone una geometria nuova dichiara prima quale controllo banale deve
   battere.** Altrimenti si ottimizza il rumore.

## 6. Cosa resta fuori, e perché

- **Dati infragiornalieri**: sono la chiave per simulare davvero questo motore, e
  costano. Fuori finché non c'è una domanda che li giustifichi.
- **Fondamentali storici**: stessa cosa, per il filtro P/E.
- **La ricerca di un vantaggio reale**: richiede i due punti sopra, un protocollo di
  controlli, una replica di strategia pubblicata per validare il simulatore, e una data
  oltre la quale si chiude. È un progetto diverso da questo, e la premessa scelta dice
  che non è questo.
- **Il broker vero**: nessun passaggio a chiavi reali è in discussione.

## 7. Cosa fare per primo

Fase A, punto 1 e 2: commissioni IBKR e termine di cambio. Sono contenute, hanno una
fonte verificata, e sbloccano ogni discussione successiva sui costi.

Poi la Fase B, perché è la più economica e la più protettiva: senza numerosità accanto
ai numeri, questo documento verrà riscritto sbagliato una seconda volta.

---

## Nota di metodo

La prima bozza di questo documento affermava un vantaggio che non esiste. L'errore non
è stato di calcolo: la media era giusta. È stato trattare 25 operazioni come 25 prove
indipendenti quando erano 8 giornate, una delle quali pesava per metà.

L'ho scoperto mettendo in discussione la mia stessa premessa, e Codex, interrogato in
modo indipendente sullo stesso documento, è arrivato allo stesso punto per un'altra
strada: «la modalità osservazione raccoglie pochi episodi altamente correlati e viene
usata come conferma».

Vale come promemoria: il modo più veloce per sbagliare qui non è un bug, è contare due
volte la stessa cosa.

*I numeri di questo documento sono calcolati, non stimati. Gli script di calcolo sono
in `docs/archive/economia-v2.mjs`.*
