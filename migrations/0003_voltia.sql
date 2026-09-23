-- Voltia data. Does not alter public.clients, public.rooms or public.users.

create schema if not exists voltia;

create table if not exists voltia.vehicles (
  id text primary key,
  owner_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voltia_vehicles_owner_idx on voltia.vehicles (owner_id);

create table if not exists voltia.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voltia_trips_owner_idx on voltia.trips (owner_id, updated_at desc);

alter table voltia.vehicles enable row level security;
alter table voltia.trips enable row level security;

drop policy if exists vehicles_catalog_read on voltia.vehicles;
create policy vehicles_catalog_read on voltia.vehicles
  for select to anon, authenticated
  using (owner_id is null);

drop policy if exists vehicles_owner_read on voltia.vehicles;
create policy vehicles_owner_read on voltia.vehicles
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists vehicles_owner_insert on voltia.vehicles;
create policy vehicles_owner_insert on voltia.vehicles
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists vehicles_owner_update on voltia.vehicles;
create policy vehicles_owner_update on voltia.vehicles
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists vehicles_owner_delete on voltia.vehicles;
create policy vehicles_owner_delete on voltia.vehicles
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists trips_owner_all on voltia.trips;
create policy trips_owner_all on voltia.trips
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant usage on schema voltia to anon, authenticated, service_role;
grant select on voltia.vehicles to anon, authenticated;
grant insert, update, delete on voltia.vehicles to authenticated;
grant select, insert, update, delete on voltia.trips to authenticated;
grant all on voltia.vehicles, voltia.trips to service_role;

alter table public.electrolineras enable row level security;

drop policy if exists electrolineras_read_approved on public.electrolineras;
create policy electrolineras_read_approved on public.electrolineras
  for select to anon, authenticated
  using (status = 'approved');

revoke all on public.electrolineras from anon, authenticated;
grant select on public.electrolineras to anon, authenticated;
