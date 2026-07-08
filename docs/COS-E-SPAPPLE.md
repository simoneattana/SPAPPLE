# Spapple

## Cos'e Spapple

Spapple e una web application di simulazione trading quantitativo e forward testing.
Il suo scopo e osservare dati di mercato reali, applicare regole operative
predefinite e simulare aperture, monitoraggi e chiusure di posizioni senza
intervento continuo dell'utente.

Spapple non e un broker e non invia ordini reali a banche, broker o exchange.
Lavora in modalita `simulation`: ogni acquisto, vendita, apertura short o
chiusura viene registrata come ordine simulato. Questo permette di testare la
strategia in modo controllato prima di valutare eventuali collegamenti futuri a
sistemi reali.

L'obiettivo pratico non e cercare grandi guadagni occasionali, ma costruire un
metodo disciplinato per provare a ottenere piccoli risultati ricorrenti,
misurabili e consultabili nello storico.

## I due mondi operativi

Spapple separa completamente due ambienti:

- Azioni Europa
- Crypto

Ogni mondo ha capitale, posizioni, storico, ordini, scansioni, regole, limiti e
colori propri. I dati non devono mischiarsi: una posizione crypto non deve
comparire nelle azioni e un risultato azionario non deve alterare la dashboard
crypto.

## Capitale iniziale

Il capitale iniziale impostato e:

- Azioni Europa: 30.000 euro
- Crypto: 20.000 euro

Il capitale operativo include anche gli utili reinvestibili. Quando una
posizione viene chiusa, il capitale recuperato rientra nel capitale disponibile.
Gli utili vengono anche registrati nei KPI, nella pagina Utili e nello storico,
cosi da poter analizzare il rendimento nel tempo.

## Modalita simulazione

Spapple usa ordini simulati con un modello broker-ready.

Ogni ordine contiene dati come:

- mercato
- ticker
- direzione
- importo investito
- prezzo richiesto
- prezzo eseguito
- quantita simulata
- stato ordine
- motivo operativo
- eventuale ID posizione

Gli stati principali degli ordini sono:

- `CREATO`
- `INVIATO`
- `ESEGUITO`
- `RIFIUTATO`

Oggi nessun ordine viene inviato a un broker reale. La struttura pero e pensata
per poter collegare in futuro un broker o un exchange, aggiungendo esecuzione
reale, commissioni, slippage e conferme dell'intermediario.

## Fonti dati

### Azioni Europa

Per il mondo azionario Spapple usa:

- EODHD come provider primario
- Yahoo Finance come fallback reale
- calcolo locale di RSI e ATR tramite `technicalindicators`

I dati usati sono:

- prezzo
- storico giornaliero
- P/E
- massimo, minimo e chiusura
- RSI 14
- ATR 14

Spapple non deve usare dati inventati, mock o valori casuali. Se un dato non e
disponibile, il titolo deve essere escluso o l'errore deve essere mostrato in
modo chiaro.

### Crypto

Per il mondo crypto Spapple usa:

- Kraken per prezzi e storico delle coppie crypto/EUR
- CoinGecko per informazioni di mercato, capitalizzazione e liquidita
- calcolo locale di RSI e ATR

La watchlist crypto operativa comprende:

- BTC/EUR
- ETH/EUR
- USDC/EUR
- BNB/EUR
- ADA/EUR
- POL/EUR
- SOL/EUR
- XRP/EUR
- TRX/EUR
- AVAX/EUR
- LINK/EUR
- DOT/EUR
- LTC/EUR

USDC e presente come riferimento di liquidita ma non viene usata per aperture
automatiche.

## Indicatori principali

### P/E

Il P/E e il rapporto prezzo/utili.
Nel mondo azionario Spapple lo usa come filtro di salute aziendale.

Regola:

- P/E maggiore di 0: titolo ammesso alla valutazione tecnica
- P/E assente, nullo o negativo: titolo scartato

Questo filtro evita di aprire posizioni su societa non profittevoli secondo il
dato disponibile.

Nel mondo crypto il P/E non esiste e quindi non viene usato.

### RSI

RSI significa Relative Strength Index.
Spapple lo usa come indicatore di "temperatura" del prezzo.

Nel mondo azionario:

- RSI sotto 30: possibile eccesso ribassista, segnale Long
- RSI sopra 70: possibile eccesso rialzista, segnale Short
- RSI tra 30 e 70: zona neutrale, titolo scartato

Il pilota automatico e ancora piu selettivo:

- Long automatico solo se RSI <= 28
- Short automatico solo se RSI >= 72

Nel mondo crypto:

- RSI sotto 36: possibile segnale Long
- RSI sopra 64: possibile segnale Short
- RSI tra 36 e 64: zona neutrale

Il pilota automatico crypto e piu selettivo:

- Long automatico solo se RSI <= 32
- Short automatico solo se RSI >= 68

### ATR

ATR significa Average True Range.
Misura quanto un titolo o una crypto si muove normalmente.

Spapple usa ATR per:

- capire la volatilita
- calibrare take profit
- calibrare stop loss
- evitare aperture automatiche su asset troppo instabili

Nel mondo azionario il pilota automatico accetta solo segnali con ATR massimo
pari al 6% del prezzo.

Nel mondo crypto il pilota automatico accetta solo segnali con ATR massimo pari
al 9% del prezzo.

## Criteri di apertura

### Apertura Long

Una posizione Long simula un acquisto.
La posizione guadagna se il prezzo sale dopo l'ingresso.

Spapple apre o propone Long quando:

- il mercato e quello corretto
- i dati sono validi
- il titolo/asset non e gia in posizione
- esiste capitale sufficiente
- esiste almeno uno slot libero
- non sono violati i limiti di rischio
- il segnale tecnico e Long

Per le azioni il segnale Long nasce da RSI sotto 30, con apertura automatica
solo se RSI <= 28.

Per le crypto il segnale Long nasce da RSI sotto 36, con apertura automatica
solo se RSI <= 32.

### Apertura Short

Una posizione Short simula un'operazione al ribasso.
La posizione guadagna se il prezzo scende dopo l'ingresso.

Spapple apre o propone Short quando:

- il mercato e quello corretto
- i dati sono validi
- il titolo/asset non e gia in posizione
- esiste capitale sufficiente
- esiste almeno uno slot libero
- non sono violati i limiti di rischio
- il segnale tecnico e Short

Per le azioni il segnale Short nasce da RSI sopra 70, con apertura automatica
solo se RSI >= 72.

Per le crypto il segnale Short nasce da RSI sopra 64, con apertura automatica
solo se RSI >= 68.

## Dimensione delle posizioni

Spapple non investe sempre una cifra fissa. Usa una logica percentuale sul
capitale operativo disponibile.

### Azioni Europa

Regole:

- capitale iniziale: 30.000 euro
- massimo posizioni aperte: 8
- importo per posizione: 10% del capitale disponibile
- minimo per posizione: 1.000 euro
- massimo per posizione: 5.000 euro

Esempio:

- se il capitale disponibile e 30.000 euro, una posizione tende a usare 3.000 euro
- se il capitale cresce, l'importo puo aumentare ma non oltre 5.000 euro
- se il capitale scende, l'importo si riduce ma non sotto 1.000 euro

### Crypto

Regole:

- capitale iniziale: 20.000 euro
- massimo posizioni aperte: 5
- importo per posizione: 5% del capitale disponibile
- minimo per posizione: 100 euro
- massimo per posizione: 1.500 euro

La dimensione crypto e piu prudente perche il mercato e piu volatile e rimane
aperto 24/7.

## Take profit

Il take profit e il prezzo al quale Spapple considera raggiunto l'obiettivo di
guadagno.

### Azioni Europa

Spapple usa un take profit dinamico basato su ATR%.

Se ATR% e sotto 1,5%:

- primo target: 0,35%
- target massimo: 0,80%
- trailing profit: 0,20%

Se ATR% e pari o sopra 1,5%:

- primo target: 0,60%
- target massimo: 1,20%
- trailing profit: 0,30%

La logica e questa:

1. Quando il prezzo raggiunge il primo target, Spapple arma la protezione del
   profitto.
2. Se il prezzo continua nella direzione giusta, Spapple lascia respirare la
   posizione fino al target massimo.
3. Se dopo il primo target il prezzo torna indietro oltre il trailing, Spapple
   chiude per consolidare il risultato.

Questa scelta evita di vendere sempre al primo piccolo movimento favorevole e
prova a catturare movimenti leggermente migliori quando il mercato li concede.

### Crypto

Nel mondo crypto il take profit e piu semplice e non usa trailing profit.

Se ATR% e sotto 4%:

- target: 0,45%

Se ATR% e pari o sopra 4%:

- target: 0,65%

La crypto e gia molto volatile, quindi Spapple evita trailing troppo sensibili
che potrebbero produrre chiusure rumorose.

## Stop loss

Lo stop loss e il prezzo di sicurezza.
Serve a chiudere una posizione quando il movimento va contro la direzione
attesa.

### Azioni Europa

Se ATR% e sotto 1,5%:

- stop loss = ATR x 1,2

Se ATR% e pari o sopra 1,5%:

- stop loss = ATR x 1,5

Per una posizione Long, lo stop loss sta sotto il prezzo di ingresso.
Per una posizione Short, lo stop loss sta sopra il prezzo di ingresso.

Quando il profitto e stato armato, Spapple puo proteggere lo stop portandolo
almeno a pareggio.

### Crypto

Nel mondo crypto:

- stop loss = ATR x 1,8

La soglia e piu larga perche le crypto hanno oscillazioni fisiologicamente piu
ampie rispetto alle azioni.

## Chiusura delle posizioni

Spapple puo chiudere una posizione in questi casi:

- take profit raggiunto
- target massimo raggiunto
- trailing profit attivato
- stop loss raggiunto
- stop a pareggio raggiunto
- protezione pre-chiusura con risk score
- chiusura manuale da interfaccia

La chiusura aggiorna:

- capitale operativo
- storico
- ordini
- dashboard
- pagina Utili
- log attivita

Se la posizione chiude in utile, l'utile entra nel capitale operativo e viene
anche tracciato come profitto.

Se la posizione chiude in perdita, il capitale recuperato viene ridotto dalla
perdita effettiva. La perdita non viene sottratta dal profitto storico gia
realizzato, ma incide sul P/L netto del periodo.

## Protezione pre-chiusura

Ogni mercato azionario e trattato con una regola prudenziale propria.

Spapple blocca nuove aperture prima della chiusura del mercato e valuta le
posizioni aperte con un risk score. Non chiude tutto in modo cieco: consolida
gli utili, protegge il capitale quando la posizione e a pareggio o positiva, e
taglia le posizioni ad alto rischio prima dell'overnight.

Le finestre principali sono:

- Europa: scansione dalle 09:05, blocco nuove aperture dalle 17:00,
  protezione dalle 17:10.
- USA: scansione dalle 09:35 New York, blocco nuove aperture dalle 15:30,
  protezione dalle 15:40.
- Asia Tokyo: scansione dalle 09:05 Tokyo, blocco nuove aperture dalle 15:00,
  protezione dalle 15:10.
- Asia Hong Kong: scansione dalle 09:35 Hong Kong, blocco nuove aperture dalle
  15:30, protezione dalle 15:45.

Questa scelta serve a rendere la simulazione piu realistica rispetto agli orari
di mercato e a ridurre il rischio di mantenere posizioni azionarie oltre la
finestra decisa.

## Scansioni automatiche

### Azioni Europa

La scansione azionaria:

- parte dalle 09:05
- blocca nuove aperture prima della chiusura del mercato
- viene programmata ogni 15 minuti
- usa EODHD/Yahoo Finance
- legge anche il contesto del mercato USA quando disponibile
- apre automaticamente solo segnali forti

Se nessun titolo supera i filtri, Spapple non apre posizioni.
Non forza mai un ingresso solo per occupare uno slot.

### Crypto

La scansione crypto:

- funziona 24/7
- viene programmata ogni 5 minuti
- usa Kraken e CoinGecko
- valuta liquidita, capitalizzazione, RSI e ATR
- apre automaticamente solo segnali abbastanza forti

Il mercato crypto puo avere momenti in cui nessun asset e apribile. Questo non
e necessariamente un errore: significa che la strategia non vede condizioni
abbastanza pulite.

## Monitor live e backend automatico

Spapple lavora su due livelli.

### App aperta

Quando l'app e aperta:

- la UI controlla lo stato remoto ogni 3 secondi
- le posizioni aperte vengono monitorate ogni 60 secondi
- countdown e messaggi mostrano cosa sta succedendo
- i dati vengono riallineati da Supabase

### App chiusa

Quando l'app e chiusa:

- Vercel Cron chiama `/api/cron/monitor`
- il monitor backend gira ogni 5 minuti
- controlla sia Azioni Europa sia Crypto
- aggiorna Supabase
- chiude posizioni se target o stop vengono raggiunti
- cerca nuovi slot se il pilota automatico trova segnali validi

Questo e il punto centrale dell'automazione: Spapple non dipende solo dal
browser aperto.

## Sincronizzazione multiutente

Lo stato autorevole vive su Supabase.

Il frontend:

- carica lo stato da `/api/state`
- ascolta eventi realtime se configurati
- usa polling ogni 3 secondi come fallback
- aggiorna la UI quando un altro utente o il backend modifica lo stato

Questo serve a evitare che due persone vedano dati diversi per troppo tempo.
Se un utente chiude una posizione, l'altro deve ricevere l'aggiornamento senza
dover necessariamente ricaricare manualmente la pagina.

## Storico, diario e utili

Spapple registra:

- aperture
- chiusure
- ordini simulati
- eventi automatici
- errori dati
- scansioni
- risultati giornalieri
- risultati mensili

La pagina Utili mostra il rendimento per giorno e per mese.
Lo storico serve per analizzare nel tempo se il metodo sta funzionando.

Le sezioni piu importanti per valutare Spapple sono:

- Dashboard del mercato
- Scanner
- Ordini
- Utili
- Storico/Diario

## Come leggere il sistema

### Dashboard

La Dashboard serve a capire lo stato generale:

- capitale operativo
- utili del giorno
- utili del mese
- P/L netto
- chiusure di oggi
- stato del pilota automatico

### Scanner

Lo Scanner mostra:

- asset analizzati
- prezzo
- motivo di ammissione o scarto
- segnali disponibili
- posizioni aperte
- valore live delle posizioni
- possibilita di chiusura manuale quando prevista

La tabella non deve essere letta come "tutto quello che appare va comprato".
Spapple distingue tra asset visibili, asset con segnale e asset davvero
apribili dal pilota automatico.

### Regia del sistema

La Regia mostra:

- prossima azione
- stato corrente
- countdown alla prossima scansione
- countdown al prossimo controllo prezzi
- stato del backend remoto
- ultimo messaggio operativo

Il suo scopo e spiegare cosa Spapple sta facendo adesso e cosa fara a breve.

## Perche alcune decisioni sono state prese

### Separazione tra azioni e crypto

Azioni e crypto hanno orari, volatilita, dati, rischio e logiche diverse.
Mischiarle avrebbe reso le dashboard poco affidabili. Per questo Spapple usa
due mondi separati.

### Pilota automatico attivo di default

L'obiettivo e ridurre l'intervento manuale.
Se il metodo deve essere testato seriamente, il sistema deve agire con regole
stabili e non dipendere dall'impulso dell'utente.

### Nessun dato finto

Una simulazione utile deve usare dati reali.
Mock, fallback casuali o numeri inventati renderebbero impossibile capire se il
metodo funziona.

### Filtri severi

Spapple preferisce non aprire nulla piuttosto che aprire male.
Per questo alcuni momenti possono sembrare "fermi": il sistema aspetta segnali
coerenti con la strategia.

### Target piccoli

La strategia punta a movimenti contenuti.
Questo riduce l'ambizione del singolo trade e rende piu importante la
ripetibilita del processo.

### Protezione oraria sulle azioni

Le azioni europee hanno una finestra operativa specifica.
Chiudere o bloccare operazioni verso fine giornata rende la simulazione piu
prudente e coerente con l'idea di non restare esposti oltre l'orario deciso.

### Persistenza Supabase

Il localStorage non basta per un'app vista da piu persone o usata da piu
dispositivi. Supabase diventa la fonte dati condivisa e permette a Vercel Cron
di lavorare anche quando il browser e chiuso.

## Limiti attuali

Spapple oggi e un simulatore avanzato, non un sistema di trading reale.

I limiti principali sono:

- nessun ordine reale viene inviato a broker o exchange
- commissioni e slippage reali non sono ancora modellati in modo completo
- la qualita dipende dalla disponibilita dei provider dati
- un provider puo restituire errori temporanei
- la strategia non garantisce profitto
- il passato simulato non garantisce risultati futuri

## Come capire se Spapple funziona

Spapple va valutato su dati accumulati, non su una singola giornata.

Gli indicatori da controllare sono:

- P/L netto giornaliero
- P/L netto mensile
- numero di operazioni chiuse
- percentuale di operazioni vincenti
- perdita media
- guadagno medio
- frequenza di apertura
- frequenza di stop loss
- comportamento per mercato
- comportamento per ticker
- differenza tra azioni e crypto

Un sistema puo avere giornate negative e funzionare comunque, oppure avere una
giornata positiva per caso e non essere robusto. La valutazione deve avvenire su
uno storico sufficientemente lungo.

## Routine consigliata

Anche se il pilota automatico e attivo, la routine corretta e:

1. Aprire la Dashboard e controllare capitale, P/L e stato backend.
2. Aprire lo Scanner per vedere cosa e stato analizzato e perche.
3. Controllare le posizioni aperte e il loro guadagno/perdita live.
4. Guardare la pagina Utili per valutare il giorno e il mese.
5. Guardare lo Storico per capire quali regole stanno producendo risultati.

L'utente non dovrebbe intervenire continuamente.
L'intervento manuale ha senso solo quando si vuole chiudere consapevolmente una
posizione prima che lo faccia la regola automatica.

## Definizione sintetica

Spapple e una piattaforma di simulazione trading automatizzata, separata per
mercati, basata su dati reali, regole quantitative, controllo continuo,
persistenza remota e storico consultabile.

Il suo valore non e "prevedere il mercato", ma imporre disciplina:

- analizza solo asset filtrati
- apre solo quando le regole lo consentono
- dimensiona le posizioni in modo prudente
- chiude secondo target, stop o protezione oraria
- registra tutto
- permette di misurare se il metodo sta migliorando

Spapple deve diventare progressivamente un laboratorio operativo affidabile:
prima simulazione robusta, poi analisi predittiva sui dati accumulati, infine
eventuale collegamento controllato a broker o exchange reali.
