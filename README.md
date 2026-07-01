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
```

La tabella `public.spapple_state` ha RLS attiva e non espone policy pubbliche.
Le letture e scritture passano dalla funzione serverless con chiave privata.

## Verifiche

```bash
npm run lint
npm run build
```
