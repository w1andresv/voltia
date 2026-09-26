-- Fase 6 del plan de electrolineras consolidadas: el caché por corredor
-- (chargers.cache.ts) ya no existe en el código, todo pasa por el dataset
-- nacional consolidado (station_dataset / station_source_snapshots).
drop table if exists charger_corridor_cache;
