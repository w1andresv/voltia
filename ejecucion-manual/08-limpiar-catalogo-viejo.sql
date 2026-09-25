-- PASO 8 (SQL Editor) — OPCIONAL. Elimina las filas viejas del catálogo (datos sin verificar).
-- Ejecuta SOLO después de confirmar el paso 7. Los vehículos de usuarios (owner_id no nulo) NO se tocan.
-- Respaldo: public.voltia_vehicles_catalog_backup_20260923 (paso 1).
delete from public.voltia_vehicles
where owner_id is null
  and id not in ('mg-s5-ev-comfort', 'mg-s5-ev-deluxe', 'tesla-model-3-lr-awd',
                 'tesla-model-y-rwd', 'tesla-model-y-lr-awd', 'volvo-ex30-sm-er');

select count(*) as filas_catalogo from public.voltia_vehicles where owner_id is null; -- esperado: 6
