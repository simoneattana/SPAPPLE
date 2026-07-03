# Spapple

Simulatore di trading quantitativo e forward testing con UI React/Vite,
persistenza locale e predisposizione per archivio remoto Supabase.

## Avvio locale

```bash
npm install
npm run dev
```

Accesso applicazione:

- Password: `alpha`

## Persistenza Supabase

Lo stato operativo di Spapple viene salvato tramite endpoint serverless
`/api/state`. Il frontend non riceve mai la chiave privata Supabase.

Ogni salvataggio incrementa `stateRevision` e genera un evento leggero nella
tabella `spapple_state_events`. Se le variabili pubbliche Supabase sono
configurate, il frontend ascolta questi eventi in realtime e ricarica lo stato
autorevole da `/api/state`; altrimenti usa polling ogni 3 secondi.

## Modalità broker-ready

Spapple lavora ancora con capitale finto, ma il flusso operativo è stato
strutturato come un sistema collegabile in futuro a broker o exchange reali.

- Modalità attuale: `simulation`
- Broker attuale: `simulationBroker`
- Nessun ordine reale viene inviato a sistemi terzi
- Ogni apertura e chiusura crea un record ordine persistente
- Gli ordini possono essere `CREATO`, `INVIATO`, `ESEGUITO` o `RIFIUTATO`
- Il kill switch blocca nuove aperture ma lascia monitorate le posizioni aperte
- Il registro ordini e separato per mercato, come capitale, posizioni e storico

Le integrazioni reali future dovranno implementare lo stesso contratto
operativo: creazione ordine, stato ordine, prezzo eseguito, quantità,
commissioni, slippage e ID ordine broker.

Variabili richieste in locale e su Vercel:

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVER_KEY=...
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
SPAPPLE_APP_PASSWORD=alpha
CRON_SECRET=...
```

Il monitor automatico backend vive su Vercel in `/api/cron/monitor`.
Lo scheduler e gestito da GitHub Actions con il workflow
`.github/workflows/spapple-monitor.yml`, ogni 5 minuti. L'endpoint accetta solo
richieste con header `Authorization: Bearer CRON_SECRET`.

La tabella richiesta è definita nella migrazione:

```bash
supabase/migrations/20260630131133_create_spapple_state.sql
supabase/migrations/20260702093958_spapple_state_realtime_events.sql
```

La tabella `public.spapple_state` ha RLS attiva e non espone policy pubbliche.
Le letture e scritture passano dalla funzione serverless con chiave privata.
La tabella `public.spapple_state_events` espone solo eventi di revisione, non il
payload operativo completo.

## Dati di mercato

Per le azioni europee Spapple usa EODHD come provider primario per storico EOD,
prezzi aggiornati e fondamentali. Yahoo Finance rimane solo come fallback reale
nel caso in cui EODHD non restituisca un singolo ticker. RSI e ATR vengono ancora
calcolati internamente con `technicalindicators`, così il metodo resta coerente e
non consuma chiamate extra sugli indicatori tecnici.

Variabile richiesta:

```bash
EODHD_API_KEY=...
```

La chiave deve essere configurata in `.env.local` per lo sviluppo locale e nelle
Environment Variables del progetto Vercel per produzione, preview e development.

## Verifiche

```bash
npm run lint
npm run build
```
