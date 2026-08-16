# Archivio — migrazioni Supabase (non più attive)

Queste migrazioni erano la fonte di verità dello schema quando Spapple girava su
Supabase. Dal commit `4861946` (migrazione a Neon PostgreSQL) lo schema attivo è
**`neon/schema.sql`**, che va eseguito nel SQL Editor di Neon.

Restano qui solo come storico. Non applicarle su Neon: contengono `enable row
level security` e `revoke ... from anon/authenticated`, cioè ruoli e policy
specifici di Supabase che su Neon non esistono.

Spostate (non cancellate) il 2026-08-16.
