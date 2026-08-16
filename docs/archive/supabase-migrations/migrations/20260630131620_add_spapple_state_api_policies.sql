grant select, insert, update on table public.spapple_state to anon;

create policy "Spapple state can be read by server endpoint"
on public.spapple_state
for select
to anon
using (id = 'default');

create policy "Spapple state can be inserted by server endpoint"
on public.spapple_state
for insert
to anon
with check (id = 'default');

create policy "Spapple state can be updated by server endpoint"
on public.spapple_state
for update
to anon
using (id = 'default')
with check (id = 'default');
