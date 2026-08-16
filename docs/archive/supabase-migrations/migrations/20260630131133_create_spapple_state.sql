create table if not exists public.spapple_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.spapple_state enable row level security;

revoke all on table public.spapple_state from anon;
revoke all on table public.spapple_state from authenticated;
