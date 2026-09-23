-- Gestión de usuarios (fase 4): relaciones con voltia.users, claves de
-- idempotencia para la importación del invitado y RLS sobre el id interno.

-- Un mismo modelo no puede entrar dos veces al catálogo con ids distintos.
-- Si ya hay duplicados, aborta ANTES de crear el índice, con un mensaje claro.
do $$
declare
  dup record;
begin
  select
    lower(payload->>'brand') as brand,
    lower(payload->>'model') as model,
    lower(payload->>'version') as version,
    payload->>'year' as year,
    count(*) as n
  into dup
  from voltia.vehicles
  where owner_id is null
  group by 1, 2, 3, 4
  having count(*) > 1
  limit 1;
  if found then
    raise exception 'Catálogo con duplicados (% % % %): resuélvelos antes de aplicar 0008.',
      dup.brand, dup.model, dup.version, dup.year;
  end if;
end $$;

-- Claves foráneas (not valid + validate: no bloquean escrituras durante la validación).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_owner_fk') then
    alter table voltia.vehicles
      add constraint vehicles_owner_fk foreign key (owner_id)
      references voltia.users (id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trips_owner_fk') then
    alter table voltia.trips
      add constraint trips_owner_fk foreign key (owner_id)
      references voltia.users (id) on delete cascade not valid;
  end if;
  if to_regclass('public.electrolineras') is not null then
    if not exists (select 1 from pg_constraint where conname = 'electrolineras_created_by_fk') then
      alter table public.electrolineras
        add constraint electrolineras_created_by_fk foreign key (created_by)
        references voltia.users (id) on delete set null not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'electrolineras_reviewed_by_fk') then
      alter table public.electrolineras
        add constraint electrolineras_reviewed_by_fk foreign key (reviewed_by)
        references voltia.users (id) on delete set null not valid;
    end if;
  end if;
end $$;

alter table voltia.vehicles validate constraint vehicles_owner_fk;
alter table voltia.trips validate constraint trips_owner_fk;
do $$
begin
  if to_regclass('public.electrolineras') is not null then
    alter table public.electrolineras validate constraint electrolineras_created_by_fk;
    alter table public.electrolineras validate constraint electrolineras_reviewed_by_fk;
  end if;
end $$;

-- Idempotencia de la importación: id local del vehículo y clientId de la ruta.
alter table voltia.vehicles add column if not exists local_id text;
update voltia.vehicles set local_id = payload->>'id' where owner_id is not null and local_id is null;
create unique index if not exists voltia_vehicles_owner_local_idx
  on voltia.vehicles (owner_id, local_id) where owner_id is not null;

alter table voltia.trips add column if not exists client_id uuid;
create unique index if not exists voltia_trips_owner_client_idx
  on voltia.trips (owner_id, client_id) where client_id is not null;

-- Índice único del catálogo (marca, modelo, versión, año).
create unique index if not exists voltia_vehicles_catalog_unique_idx
  on voltia.vehicles (
    lower(payload->>'brand'),
    lower(payload->>'model'),
    lower(payload->>'version'),
    (payload->>'year')
  )
  where owner_id is null;

-- Políticas reescritas sobre el id interno (voltia.current_user_id()).
drop policy if exists vehicles_owner_read on voltia.vehicles;
create policy vehicles_owner_read on voltia.vehicles
  for select to authenticated
  using (owner_id = voltia.current_user_id());

drop policy if exists vehicles_owner_insert on voltia.vehicles;
create policy vehicles_owner_insert on voltia.vehicles
  for insert to authenticated
  with check (owner_id = voltia.current_user_id());

drop policy if exists vehicles_owner_update on voltia.vehicles;
create policy vehicles_owner_update on voltia.vehicles
  for update to authenticated
  using (owner_id = voltia.current_user_id())
  with check (owner_id = voltia.current_user_id());

drop policy if exists vehicles_owner_delete on voltia.vehicles;
create policy vehicles_owner_delete on voltia.vehicles
  for delete to authenticated
  using (owner_id = voltia.current_user_id());

drop policy if exists trips_owner_all on voltia.trips;
create policy trips_owner_all on voltia.trips
  for all to authenticated
  using (owner_id = voltia.current_user_id())
  with check (owner_id = voltia.current_user_id());
