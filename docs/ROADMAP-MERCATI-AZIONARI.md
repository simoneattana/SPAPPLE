# Roadmap migrazione Spapple: Europa, USA, Asia

## Obiettivo

Eliminare completamente il mondo Crypto e trasformare Spapple in una piattaforma
multi-mercato azionaria con tre aree operative:

- Europa
- USA
- Asia

Ogni mercato deve avere dati, capitale, posizioni, ordini, storico, utili,
scanner, log e automazioni separati.

La valuta operativa deve essere quella originale del mercato, ma Spapple deve
mostrare sempre anche il controvalore in euro tramite cambi Forex EODHD.

## Principio guida

La piattaforma deve restare leggibile e affidabile.

Per questo:

- la valuta base di confronto rimane EUR
- il prezzo originale resta nella valuta del titolo
- il cambio verso EUR viene letto da EODHD
- il P/L viene mostrato sia in valuta originale sia in EUR
- lo storico salva cambio di ingresso e cambio di uscita
- nessun dato crypto deve rimanere visibile o operativo

## Fase 1 - Fondamenta tecniche

Scopo: introdurre i nuovi mattoni senza rompere la UI esistente.

Attivita:

- creare servizio Forex basato su EODHD
- creare endpoint interno `/api/eodhd/forex`
- introdurre formatter valuta dinamico
- definire universi iniziali USA e Asia
- creare strategie `usa` e `asia`
- aggiornare tema mercati con colori distinti
- mantenere build e lint verdi

Verifica:

- `npm run lint`
- `npm run build`
- test endpoint Forex con `EURUSD.FOREX`, `EURJPY.FOREX`, `EURHKD.FOREX`

## Fase 2 - Sostituzione Crypto con mercati azionari

Scopo: rimuovere Crypto dalla navigazione e introdurre le nuove route.

Nuove route:

- `/europa/dashboard`
- `/europa/scanner`
- `/europa/ordini`
- `/europa/utili`
- `/europa/diario`
- `/usa/dashboard`
- `/usa/scanner`
- `/usa/ordini`
- `/usa/utili`
- `/usa/diario`
- `/asia/dashboard`
- `/asia/scanner`
- `/asia/ordini`
- `/asia/utili`
- `/asia/diario`

Redirect:

- `/azioni/*` verso `/europa/*`
- `/crypto/*` verso `/usa/dashboard` oppure pagina di redirect controllata

Attivita:

- aggiornare `App.jsx`
- aggiornare `MainLayout.jsx`
- rimuovere menu Crypto
- rinominare `equities` in `europe` o mantenere compatibilita interna con migrazione
- aggiornare `marketCopy`
- aggiornare `marketTheme`

Verifica:

- ogni route deve mostrare solo il mercato corretto
- menu mobile e desktop devono restare usabili
- nessuna label Crypto deve comparire nella UI

## Fase 3 - Scanner multi-borsa e valuta dinamica

Scopo: scanner azionario comune per Europa, USA e Asia.

Attivita:

- estendere `fetchMarketData(tickers, marketId)`
- associare ogni ticker alla valuta originale
- recuperare cambio verso EUR con EODHD Forex
- aggiungere campi:
  - `currency`
  - `currentPrice`
  - `fxToEur`
  - `currentPriceEur`
  - `atrEur`
  - `provider`
- aggiornare tabella scanner con:
  - Prezzo mercato
  - Cambio EUR
  - Valore EUR
  - RSI
  - P/E
  - ATR
  - Segnale
  - Azione

Verifica:

- titolo EUR mostra cambio 1
- titolo USD mostra prezzo USD + EUR
- titolo JPY/HKD mostra prezzo locale + EUR
- filtri P/E, RSI e ATR restano invariati

## Fase 4 - Trading engine e P/L multi-valuta

Scopo: rendere aperture e chiusure coerenti con valute diverse.

Attivita:

- salvare in posizione:
  - valuta originale
  - prezzo ingresso originale
  - cambio ingresso
  - prezzo ingresso EUR
  - investito EUR
  - quantita simulata
- monitorare prezzo live originale
- recuperare cambio live
- calcolare:
  - P/L in valuta originale
  - P/L in EUR
  - P/L percentuale
- salvare in storico:
  - cambio ingresso
  - cambio uscita
  - P/L originale
  - P/L EUR

Verifica:

- capitale e utili restano in EUR
- dashboard mostra valori coerenti
- storico e pagina Utili leggono P/L EUR
- la posizione mostra anche prezzo originale e cambio

## Fase 5 - Orari operativi

Scopo: rendere realistici gli orari di scansione.

Europa:

- prima scansione: 09:05 Europe/Rome
- blocco nuove aperture: 17:00 Europe/Rome
- protezione pre-chiusura con risk score: dalle 17:10 Europe/Rome

USA:

- mercato principale: NYSE/Nasdaq
- scansione dopo apertura USA: 09:35 New York
- blocco nuove aperture: 15:30 New York
- protezione pre-chiusura con risk score: dalle 15:40 New York

Asia:

- prima versione: Giappone + Hong Kong
- Tokyo: scansione 09:05, blocco 15:00, protezione 15:10
- Hong Kong: scansione 09:35, blocco 15:30, protezione 15:45
- se la finestra asiatica e chiusa, nessuna nuova apertura

Verifica:

- countdown chiaro per ogni mercato
- nessuna apertura fuori finestra
- chiusure/protezioni tracciate nello storico

## Fase 6 - Persistenza e migrazione stato

Scopo: pulire lo stato remoto e rimuovere definitivamente Crypto.

Attivita:

- incrementare `STORAGE_VERSION`
- migrare `equities` verso `europe`
- inizializzare `usa` e `asia`
- rimuovere `crypto` dallo stato
- conservare storico azionario esistente dove coerente
- decidere se archiviare o eliminare storico crypto

Nota:

Prima di cancellare dati crypto da Supabase, serve conferma esplicita. La
modifica e distruttiva sullo storico crypto.

Verifica:

- Supabase contiene solo mercati azionari attivi
- refresh browser non reintroduce crypto
- due utenti vedono lo stesso stato
- Vercel Cron aggiorna tutti i mercati azionari

## Fase 7 - Pulizia tecnica

Scopo: eliminare codice non piu usato.

Rimuovere:

- `src/services/cryptoApi.js`
- `src/services/cryptoRules.js`
- `src/services/cryptoUniverse.js`
- `src/strategies/crypto.js`
- `api/kraken/*`
- `api/coingecko/*`
- testi, label e fallback crypto

Verifica:

- `rg "crypto|Crypto|Kraken|CoinGecko"` non deve restituire riferimenti
  operativi, salvo documentazione storica se mantenuta.

## Decisione UX raccomandata

La UI deve avere tre aree distinte nella sidebar:

- Europa
- USA
- Asia

Ogni area usa le stesse sezioni:

- Dashboard
- Scanner
- Ordini
- Utili
- Storico

Colori:

- Europa: verde neon `#deff9a`
- USA: ciano premium
- Asia: ambra/oro

La dashboard deve sempre indicare:

- mercato attivo
- valuta principale del mercato
- capitale in EUR
- sessione aperta/chiusa
- prossima scansione
- ultimo cambio usato quando rilevante

## Rischi principali

- confondere valuta originale e valore EUR
- far comparire dati di un mercato nell'altro
- migrare male lo stato Supabase
- mantenere codice crypto morto che interferisce con il nuovo modello
- usare orari di mercato troppo semplificati
- calcolare P/L usando cambi incoerenti

## Criterio di completamento

La migrazione e completata quando:

- Crypto non e piu presente nella UI
- Europa, USA e Asia sono navigabili separatamente
- ogni mercato ha scanner, dashboard, ordini, utili e storico propri
- prezzi e P/L mostrano valuta originale + controvalore EUR
- Supabase persiste solo la nuova struttura
- Vercel Cron monitora i tre mercati
- lint e build passano
