-- Caché por corredor de las consultas a OSM/PlugShare (24h). Nunca guarda
-- electrolineras de la comunidad ni del catálogo del operador: esas siempre
-- se leen en vivo (ver src/infrastructure/providers/chargers.cache.ts).
--
-- Igual que rate_limits: solo la conexión directa por DATABASE_URL (getSql())
-- la toca, nunca la API pública de Supabase.

create table if not exists charger_corridor_cache (
  id text primary key, -- hash de las sondas del corredor
  chargers_json jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists charger_corridor_cache_expires_idx on charger_corridor_cache (expires_at);

alter table charger_corridor_cache enable row level security;
revoke all on charger_corridor_cache from anon, authenticated;
