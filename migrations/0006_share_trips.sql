-- Fase 4.2: compartir un viaje por link público, sin sesión.

alter table voltia.trips add column if not exists share_id text unique;
alter table voltia.trips add column if not exists shared boolean not null default false;

create index if not exists voltia_trips_share_id_idx on voltia.trips (share_id) where share_id is not null;

-- Lectura pública SOLO de un viaje marcado como compartido; el resto de
-- columnas/filas del dueño siguen protegidas por trips_owner_all (0003).
drop policy if exists trips_public_read_shared on voltia.trips;
create policy trips_public_read_shared on voltia.trips
  for select to anon, authenticated
  using (shared = true);

grant select on voltia.trips to anon;
