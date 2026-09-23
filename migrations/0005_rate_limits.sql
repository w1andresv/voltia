-- Límite de uso por IP/usuario (fase 1 del plan), backend propio en vez de
-- un servicio externo: una tabla de ventana fija que planTripFn y
-- createStationFn incrementan en src/infrastructure/rate-limit.ts.
--
-- Nunca se expone vía la API pública de Supabase (RLS activo, sin policies,
-- sin grants a anon/authenticated): solo la conexión directa por
-- DATABASE_URL (getSql()) la toca.

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;
