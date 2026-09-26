-- Dataset nacional consolidado de electrolineras (docs/plan-electrolineras-consolidadas.md).
-- Snapshot por fuente (para poder servir el último válido si una fuente falla)
-- y el dataset ya consolidado y versionado. Mismo patrón de seguridad que
-- charger_corridor_cache y rate_limits: solo DATABASE_URL lo toca.

create table if not exists station_source_snapshots (
  source_id text primary key,
  records jsonb not null,
  fetched_at timestamptz not null default now(),
  ok boolean not null default true,
  error text
);

create table if not exists station_dataset (
  id text primary key default 'current',
  version text not null,
  dataset jsonb not null,
  generated_at timestamptz not null default now()
);

alter table station_source_snapshots enable row level security;
alter table station_dataset enable row level security;
revoke all on station_source_snapshots from anon, authenticated;
revoke all on station_dataset from anon, authenticated;
