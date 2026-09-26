-- Calibración (D13, guía 05 §5.8): lo que el usuario observó al terminar un
-- viaje guardado ("¿Con cuánto llegaste?"), para comparar con lo que el plan
-- predijo y calibrar los parámetros estimados del modelo. Una observación por
-- viaje (la última reemplaza a la anterior); se borra con el viaje.

create table if not exists public.voltia_trip_observations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.voltia_trips (id) on delete cascade,
  owner_id uuid not null,
  -- TripObservation (src/domain/ev/contracts/calibration.ts)
  payload jsonb not null,
  -- ObservationComparison: error de SOC, error de energía, razón de consumo
  comparison jsonb not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists voltia_trip_observations_trip_idx on public.voltia_trip_observations (trip_id);
create index if not exists voltia_trip_observations_owner_idx on public.voltia_trip_observations (owner_id, updated_at desc);
create index if not exists voltia_trip_observations_model_idx on public.voltia_trip_observations (model_version);

alter table public.voltia_trip_observations enable row level security;

-- Solo el dueño lee y escribe sus observaciones (mismo criterio que voltia_trips).
drop policy if exists trip_observations_owner_all on public.voltia_trip_observations;
create policy trip_observations_owner_all on public.voltia_trip_observations
  for all to authenticated
  using (owner_id = public.voltia_current_user_id())
  with check (owner_id = public.voltia_current_user_id());

grant select, insert, update, delete on public.voltia_trip_observations to authenticated;
grant all on public.voltia_trip_observations to service_role;
