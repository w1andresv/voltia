-- Quién creó y quién revisó cada electrolinera aportada por la comunidad.
-- Necesario para que updateStationFn (Fase 1) pueda saber si quien edita
-- es el autor original mientras la ficha sigue pendiente.

alter table electrolineras
  add column if not exists created_by uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

create index if not exists electrolineras_created_by_idx on electrolineras (created_by);
