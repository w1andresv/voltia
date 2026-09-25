-- PASO 1 (SQL Editor de Supabase) — Respaldo del catálogo actual, ANTES de migrar.
-- (Todavía está en voltia.vehicles; la migración 0010 lo mueve a public.voltia_vehicles.)
-- El respaldo va en public con RLS activado (sin políticas = nadie lo lee por la API).
create table if not exists public.voltia_vehicles_catalog_backup_20260923 as
select * from voltia.vehicles where owner_id is null;

alter table public.voltia_vehicles_catalog_backup_20260923 enable row level security;

select count(*) as filas_respaldadas from public.voltia_vehicles_catalog_backup_20260923;
