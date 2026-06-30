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

Variabili richieste in locale e su Vercel:

```bash
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVER_KEY=...
SPAPPLE_APP_PASSWORD=alpha
```

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
