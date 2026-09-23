-- PASO 7 (SQL Editor) — Verifica el catálogo sembrado.
-- Deben aparecer: mg-s5-ev-comfort, mg-s5-ev-deluxe, tesla-model-3-lr-awd,
--                 tesla-model-y-rwd, tesla-model-y-lr-awd, volvo-ex30-sm-er
select id,
       payload->>'brand'      as marca,
       payload->>'model'      as modelo,
       payload->>'version'    as version,
       payload->>'year'       as anio,
       payload->>'batteryKwh' as bateria_kwh,
       payload->>'rangeKm'    as autonomia_km
from public.voltia_vehicles
where owner_id is null
order by 2, 3, 4;
