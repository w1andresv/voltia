-- PASO 2 (SQL Editor) — Pre-chequeo de duplicados en el catálogo.
-- La migración 0008 crea un índice único (marca, modelo, versión, año) y ABORTA si hay duplicados.
-- Resultado esperado: 0 filas. Si devuelve filas, borra los duplicados sobrantes ANTES del paso 3.
select lower(payload->>'brand')   as marca,
       lower(payload->>'model')   as modelo,
       lower(payload->>'version') as version,
       payload->>'year'           as anio,
       count(*)                   as filas,
       array_agg(id)              as ids
from voltia.vehicles
where owner_id is null
group by 1, 2, 3, 4
having count(*) > 1;
