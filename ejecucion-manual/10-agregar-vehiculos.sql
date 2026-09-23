-- AGREGAR VEHÍCULOS AL CATÁLOGO (SQL Editor de Supabase)
-- Requiere la migración 0010 (tabla public.voltia_vehicles).
--
-- Cómo usarlo:
--   1. Edita/añade filas en el bloque "insert into nuevos_vehiculos values (...)".
--      Una fila = una versión. Borra las que no quieras.
--   2. Ejecuta TODO el archivo. Si una fila tiene un dato inválido, se aborta sin
--      cambiar nada y el error dice cuál es.
--   3. Rerunnable: volver a ejecutarlo actualiza las filas (upsert por id) y nunca
--      toca vehículos de usuarios. La app lo muestra en ≤10 min (o reinicia npm run dev).
--
-- Columnas:
--   id           texto único, minúsculas-con-guiones (p. ej. 'byd-seal-awd')
--   bateria_kwh  capacidad útil/neta si se conoce; si no, la publicada
--   autonomia_km WLTP (no mezclar con NEDC/CLTC, que dan cifras más altas)
--   peso_kg      peso en vacío · motor_kw potencia máx. (hp × 0,7457)
--   ac_kw        cargador a bordo AC · dc_kw carga rápida DC máxima
--   conectores   de: ccs2, ccs1, type2, chademo, nacs, gb_t
--   curva        'default' o 'tesla' (curva de carga genérica de la app)
--
-- ⚠️ DATOS PRECARGADOS: son de REFERENCIA, no de la ficha colombiana oficial.
--   Salen de docs/catalogo-pendientes.md (prensa colombiana, consultada 2026-09-23)
--   completados con cifras internacionales de la misma variante, marcadas [INT].
--   Verifícalos contra la ficha del concesionario antes de usarlos en producción.

create temp table if not exists nuevos_vehiculos (
  id text primary key,
  marca text not null,
  modelo text not null,
  anio int not null,
  version text not null,
  bateria_kwh numeric not null,
  autonomia_km numeric not null,
  peso_kg numeric not null,
  motor_kw numeric not null,
  ac_kw numeric not null,
  dc_kw numeric not null,
  conectores text[] not null,
  curva text not null default 'default'
);
truncate nuevos_vehiculos;

insert into nuevos_vehiculos
  (id, marca, modelo, anio, version, bateria_kwh, autonomia_km, peso_kg, motor_kw, ac_kw, dc_kw, conectores, curva)
values
  -- MG ZS EV: 51 kWh / 320 km WLTP / 174 hp [CO]; neta, peso, AC, DC [INT]
  ('mg-zs-ev-comfort',        'MG',        'ZS EV',          2024, 'Comfort',             49.0, 320, 1570, 130, 7,    76,  array['ccs2','type2'], 'default'),
  -- MG4 Cross: batería neta, autonomía, potencia y AC [CO]; peso y DC [INT]
  ('mg4-cross-deluxe-64',     'MG',        'MG4 Cross',      2026, 'Deluxe 64 kWh',       61.7, 450, 1685, 150, 11,   135, array['ccs2','type2'], 'default'),
  ('mg4-cross-plus-51',       'MG',        'MG4 Cross',      2026, 'Plus 51 kWh',         50.8, 350, 1655, 125, 6.6,  117, array['ccs2','type2'], 'default'),
  -- Tesla Model 3 RWD: 60 kWh LFP / 520 km / 283 hp / 1.765 kg [CO]; neta, AC (UE) y DC [INT]
  ('tesla-model-3-rwd',       'Tesla',     'Model 3',        2026, 'RWD',                 57.5, 520, 1765, 208, 11,   170, array['ccs2','type2'], 'tesla'),
  -- BYD Atto 3: todo [INT] (no hubo ficha colombiana)
  ('byd-atto-3',              'BYD',       'Atto 3',         2025, 'Extended Range',      60.5, 420, 1750, 150, 7,    88,  array['ccs2','type2'], 'default'),
  -- BYD Seal AWD: 82,6 kWh / 522 hp / DC 150 [CO]; WLTP, peso y AC [INT]
  ('byd-seal-awd',            'BYD',       'Seal',           2024, 'Excellence AWD',      82.5, 520, 2185, 390, 11,   150, array['ccs2','type2'], 'default'),
  -- BYD Dolphin 60 kWh: 60,4 kWh / 174 hp [CO]; WLTP, peso, AC y DC [INT]
  ('byd-dolphin-60',          'BYD',       'Dolphin',        2026, '60 kWh',              60.4, 427, 1658, 130, 11,   88,  array['ccs2','type2'], 'default'),
  -- Kia EV6 GT Line RWD: 77,4 kWh / 528 km / 1.910 kg / 228 hp / CCS1 [CO]; AC y DC [INT]
  ('kia-ev6-gt-line-rwd',     'Kia',       'EV6',            2025, 'GT Line RWD',         77.4, 528, 1910, 168, 11,   233, array['ccs1'],         'default'),
  -- Renault Megane E-Tech: todo [INT] (ficha colombiana no disponible)
  ('renault-megane-e-tech-techno', 'Renault', 'Megane E-Tech', 2025, 'Techno EV60',     60.0, 450, 1636, 160, 7.4,  130, array['ccs2','type2'], 'default'),
  -- BMW iX1 xDrive30: 64,7 kWh / 440 km / 230 kW / DC 130 [CO]; peso y AC [INT]
  ('bmw-ix1-xdrive30',        'BMW',       'iX1',            2023, 'xDrive30 xLine',      64.7, 440, 2085, 230, 11,   130, array['ccs2','type2'], 'default'),
  -- Chevrolet Bolt EUV: 65 kWh / 456 km WLTP / 150 kW / DC 55 [CO]; peso, AC y conector (EE.UU.) [INT]
  ('chevrolet-bolt-euv-lt',   'Chevrolet', 'Bolt EUV',       2022, 'LT',                  65.0, 456, 1680, 150, 11,   55,  array['ccs1'],         'default'),
  -- Zeekr X: 66 kWh / 440-400 km / 272-428 hp / AC 22 / DC 150 [CO]; peso [INT]
  ('zeekr-x-premium-rwd',     'Zeekr',     'X',              2024, 'Premium RWD',         66.0, 440, 1875, 200, 22,   150, array['ccs2','type2'], 'default'),
  ('zeekr-x-flagship-awd',    'Zeekr',     'X',              2024, 'Flagship AWD',        66.0, 400, 1955, 315, 22,   150, array['ccs2','type2'], 'default');

-- Validación: aborta todo si alguna fila no cumple lo que la app exige (VehicleSchema).
do $$
declare
  malo record;
begin
  select id, case
      when id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then 'id: usa minúsculas, números y guiones'
      when least(bateria_kwh, autonomia_km, peso_kg, motor_kw, ac_kw, dc_kw) <= 0 then 'todas las cifras deben ser > 0'
      when bateria_kwh > 250 or autonomia_km > 1200 or peso_kg > 4000 or dc_kw > 500 or ac_kw > 44 then 'cifra fuera de rango (¿unidades?)'
      when cardinality(conectores) = 0 then 'falta al menos un conector'
      when not conectores <@ array['ccs2','ccs1','type2','chademo','nacs','gb_t'] then 'conector desconocido'
      when curva not in ('default', 'tesla') then 'curva debe ser default o tesla'
      when anio not between 2010 and 2035 then 'año fuera de rango'
    end as problema
  into malo
  from nuevos_vehiculos
  where id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or least(bateria_kwh, autonomia_km, peso_kg, motor_kw, ac_kw, dc_kw) <= 0
     or bateria_kwh > 250 or autonomia_km > 1200 or peso_kg > 4000 or dc_kw > 500 or ac_kw > 44
     or cardinality(conectores) = 0
     or not conectores <@ array['ccs2','ccs1','type2','chademo','nacs','gb_t']
     or curva not in ('default', 'tesla')
     or anio not between 2010 and 2035
  limit 1;
  if found then
    raise exception 'Fila inválida "%": %', malo.id, malo.problema;
  end if;

  -- Un id nuevo que repite marca+modelo+versión+año de OTRA fila del catálogo chocaría con el índice único.
  select n.id, c.id as existente into malo
  from nuevos_vehiculos n
  join public.voltia_vehicles c
    on c.owner_id is null and c.id <> n.id
   and lower(c.payload->>'brand') = lower(n.marca)
   and lower(c.payload->>'model') = lower(n.modelo)
   and lower(c.payload->>'version') = lower(n.version)
   and c.payload->>'year' = n.anio::text
  limit 1;
  if found then
    raise exception 'La fila "%" repite marca/modelo/versión/año del vehículo existente "%": usa ese mismo id para actualizarlo.', malo.id, malo.existente;
  end if;
end;
$$;

insert into public.voltia_vehicles as v (id, owner_id, payload)
select
  n.id,
  null,
  jsonb_build_object(
    'id', n.id,
    'brand', n.marca,
    'model', n.modelo,
    'year', n.anio,
    'version', n.version,
    'batteryKwh', n.bateria_kwh,
    'rangeKm', n.autonomia_km,
    'weightKg', n.peso_kg,
    'motorKw', n.motor_kw,
    'acMaxKw', n.ac_kw,
    'dcMaxKw', n.dc_kw,
    'connectors', to_jsonb(n.conectores),
    'consumptionKwhPer100km', null,
    'consumptionManual', false,
    'minSocRecommended', 15,
    'maxSocTravel', 80,
    'chargeCurve', case n.curva
      when 'tesla' then '[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}]'::jsonb
      else '[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}]'::jsonb
    end
  )
from nuevos_vehiculos n
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Resultado: catálogo completo.
select id, payload->>'brand' as marca, payload->>'model' as modelo, payload->>'version' as version,
       payload->>'year' as anio, payload->>'batteryKwh' as kwh, payload->>'rangeKm' as km
from public.voltia_vehicles
where owner_id is null
order by 2, 3, 4;
