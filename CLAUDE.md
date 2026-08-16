# Spapple — regole di progetto

## Branch unico

Questo repository ha **solo `main`**. Non creare feature branch, non aprire pull
request, non usare worktree. Si lavora e si committa direttamente su `main`, e si
pusha su `origin/main`.

Vale anche per gli agenti: se un flusso di lavoro prevede "crea un branch e apri
una PR", su questo progetto si salta quel passaggio e si committa su `main`.

Se un agente esterno (Codex, v0, o altri) pubblica un branch su GitHub, va chiuso:
il lavoro utile si estrae come patch in `docs/archive/esperimenti/` e il branch si
elimina.

## Database

Neon PostgreSQL, provisionato dal Marketplace Vercel. Lo schema attivo è
`neon/schema.sql`, da eseguire nel SQL Editor di Neon. Le migrazioni in
`docs/archive/supabase-migrations/` sono storia: non applicarle.

La connessione arriva da `DATABASE_URL`. In locale si ottiene con `vercel env pull`.

## Deploy

`vercel deploy --prod` dalla CLI. Il progetto Vercel è `spapple`.

## Pilota automatico

Il cron `/api/cron/monitor` è **sospeso** dal 2026-08-16: il blocco `crons` è stato
tolto da `vercel.json`. Non riaccenderlo finché il modello costi non è allineato a
IBKR e i bersagli delle operazioni non stanno sopra il costo del giro completo.
Le istruzioni per riattivarlo sono in cima a `api/cron/monitor.js`.
