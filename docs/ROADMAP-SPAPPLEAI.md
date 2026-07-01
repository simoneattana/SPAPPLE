# Roadmap SpappleAI

## Obiettivo

SpappleAI nasce come evoluzione sperimentale di Spapple.

L'obiettivo non e cercare performance aggressive, leva o operativita ad alta
frequenza. L'obiettivo e verificare se una strategia prudente, automatizzata e
misurabile puo generare piccoli profitti ricorrenti, con rischio controllato e
con dati abbastanza solidi da capire se il metodo ha aspettativa positiva.

SpappleAI deve quindi migliorare tre aspetti:

1. misurare il profitto netto reale, non solo il movimento teorico del prezzo;
2. imparare quali asset rispettano meglio la logica "poco ma spesso";
3. decidere aperture e chiusure con regole dinamiche ma comprensibili.

## Principi non negoziabili

- Nessun dato mock per simulare profitti.
- Nessun capitale reale finche la simulazione non dimostra coerenza.
- Nessuna leva nella fase iniziale.
- Nessuna promessa di profitto quotidiano.
- Ogni decisione deve essere spiegabile nella UI.
- Ogni ordine deve avere audit: perche e stato aperto, perche e stato rifiutato,
  perche e stato chiuso.
- Ogni mercato deve restare separato: capitale, posizioni, storico, regole,
  stato e diagnostica.

## Priorita 1: motore costi

Per una strategia che punta a piccoli margini, il profitto lordo non basta.

SpappleAI deve calcolare sempre:

```txt
profitto netto = profitto lordo - spread stimato - commissioni - slippage stimato
```

Campi da aggiungere a ogni trade:

- `grossPnlEur`
- `estimatedSpreadEur`
- `estimatedFeesEur`
- `estimatedSlippageEur`
- `netPnlEur`
- `netPnlPct`

Regola operativa:

- una posizione non deve essere aperta se il target netto stimato e troppo
  vicino ai costi;
- il take profit deve considerare i costi prima di considerare il trade
  realmente profittevole.

## Priorita 2: score storico per asset

Ogni asset deve sviluppare una reputazione interna.

Metriche minime per asset:

- numero segnali generati;
- numero aperture eseguite;
- percentuale trade vincenti;
- profitto netto medio;
- perdita netta media;
- rapporto profitto/perdita;
- tempo medio in posizione;
- drawdown medio;
- numero stop loss consecutivi;
- performance ultimi 7, 30 e 60 giorni.

Output atteso:

- `assetScore` da 0 a 100;
- classificazione: `Preferito`, `Neutrale`, `Sotto osservazione`, `Bloccato`;
- priorita automatica agli asset che storicamente performano meglio.

Regola operativa:

- a parita di segnale tecnico, SpappleAI deve preferire l'asset con miglior
  storico netto;
- un asset con troppe perdite recenti deve entrare in quarantena temporanea.

## Priorita 3: take profit dinamico netto

Il target fisso e semplice, ma spesso troppo rigido.

SpappleAI deve calcolare il take profit usando:

- ATR percentuale;
- spread stimato;
- volatilita recente;
- forza del segnale RSI;
- score storico dell'asset;
- tipo di mercato: azioni o crypto.

Esempio di logica:

```txt
target netto minimo = costi stimati + margine prudente

se asset liquido, stabile e storicamente affidabile:
  target piu piccolo e rapido

se asset volatile ma affidabile:
  target piu alto

se spread/costi troppo alti:
  trade rifiutato
```

## Priorita 4: stop loss dinamico

Lo stop loss deve evitare sia perdite eccessive sia uscite inutili per rumore.

Variabili da considerare:

- ATR;
- volatilita recente;
- distanza dal prezzo di ingresso;
- storico dell'asset;
- direzione del trade;
- eventuali perdite consecutive.

Regole consigliate:

- stop piu stretto su asset storicamente fragili;
- stop piu largo solo se il rapporto rischio/rendimento resta accettabile;
- nessuna apertura se lo stop richiesto rende il rischio troppo alto.

## Priorita 5: filtro qualita segnale

Non basta RSI in zona estrema.

Prima di aprire una posizione, SpappleAI dovrebbe verificare:

- RSI in zona utile;
- ATR compatibile con il mercato;
- volume sufficiente;
- spread stimato accettabile;
- assenza di cooldown;
- nessuna perdita recente pesante sullo stesso asset;
- target netto raggiungibile;
- rapporto rischio/rendimento minimo.

Output UI richiesto:

- `Apribile automaticamente`;
- `Segnale visibile ma non apribile`;
- `Scartato`;
- motivazione sintetica in italiano.

## Priorita 6: diagnostica delle mancate aperture

Quando gli slot sono liberi ma non viene aperto nulla, la UI deve dirlo in modo
esplicito.

Esempi:

- "Dati arrivati: 13 asset analizzati."
- "Segnali trovati: 1."
- "Aperture automatiche: 0."
- "Motivo: RSI interessante ma non abbastanza forte per il pilota automatico."
- "Prossimo controllo tra 4 minuti."

Questo punto e fondamentale per evitare la sensazione che il sistema sia fermo.

## Priorita 7: simulazione broker-ready

Prima del trading reale, SpappleAI deve distinguere chiaramente:

- simulazione;
- paper trading;
- trading reale.

Per ogni ordine servono:

- `executionMode`
- `broker`
- `brokerOrderId`
- `submittedAt`
- `filledAt`
- `fillPrice`
- `requestedPrice`
- `slippage`
- `fees`
- `status`

Nel reale, la chiusura a target non dovrebbe dipendere solo dal controllo ogni
minuto. Bisogna predisporre ordini bracket/OCO quando il broker o exchange lo
supporta.

## Priorita 8: regole anti-overtrading

SpappleAI deve poter controllare spesso, ma non deve operare troppo.

Regole consigliate:

- crypto: massimo 12 aperture eseguite al giorno;
- azioni: massimo coerente con il numero di slot;
- rifiuti e chiusure non consumano il limite aperture;
- cooldown dopo profitto piu breve;
- cooldown dopo perdita piu lungo;
- blocco temporaneo dopo perdite consecutive;
- nessuna riapertura immediata dello stesso asset.

## Priorita 9: calendario performance

La pagina Utili deve diventare un cruscotto decisionale.

Da visualizzare:

- P/L netto del giorno;
- P/L netto del mese;
- profitti lordi;
- costi stimati;
- numero trade;
- win rate;
- miglior asset;
- peggior asset;
- giorni positivi vs negativi.

Il calendario deve aiutare a capire se il sistema e stabile o se produce solo
risultati casuali.

## Cosa non aggiungere ora

Da evitare nella prima fase SpappleAI:

- leva finanziaria;
- CFD;
- centinaia di asset senza scoring;
- intelligenza artificiale predittiva non verificabile;
- news sentiment;
- strategie troppo complesse;
- trading reale;
- ottimizzazioni fatte solo per aumentare il numero di operazioni.

## Fasi operative consigliate

### Fase 1: copia stabile e isolamento

- Duplicare Spapple in SpappleAI.
- Rinominare progetto, README e stato remoto.
- Separare localStorage e record Supabase.
- Verificare build e login.
- Verificare che Spapple e SpappleAI non condividano lo stesso stato operativo.

### Fase 2: costi e profitto netto

- Aggiungere il motore costi.
- Aggiornare storico, ordini, dashboard e pagina Utili.
- Mostrare sempre lordo, costi e netto.

### Fase 3: score storico asset

- Calcolare metriche per asset.
- Mostrare classifica asset.
- Usare lo score nelle aperture automatiche.

### Fase 4: target e stop dinamici

- Rendere take profit e stop loss variabili.
- Salvare la motivazione di ogni target.
- Confrontare performance prima/dopo.

### Fase 5: paper trading

- Valutare broker/exchange compatibili.
- Integrare solo modalita paper trading.
- Nessun capitale reale.

## Criterio di successo

SpappleAI ha senso solo se, dopo un periodo minimo di osservazione, mostra:

- P/L netto positivo;
- drawdown contenuto;
- risultati non concentrati su un singolo colpo fortunato;
- coerenza tra mercati;
- spiegazioni chiare per aperture e mancate aperture;
- storico sufficiente per capire cosa funziona e cosa no.

Finche questi criteri non sono soddisfatti, SpappleAI deve restare una
simulazione.
