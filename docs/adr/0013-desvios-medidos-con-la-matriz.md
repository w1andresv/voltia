# 0013. Desvíos medidos con la matriz de Mapbox, detrás de DETOUR_SOURCE

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F4 (guía 05, §5.2)

## Contexto
El desvío a una estación se estima como 2 × distancia en línea recta × `detourRoadFactor` (1, estimado). En montaña la vía real puede ser mucho más larga. La pasada 2 mide el desvío real solo del plan recomendado y con `v2`; las demás estaciones candidatas siguen estimadas, y el planificador elige con esa estimación.

## Decisión
- **Variable:** `DETOUR_SOURCE = estimated | matrix`, por defecto `estimated` (sin consultas extra). Con `matrix` y token de Mapbox:
  - **qué se mide:** para cada ruta, las estaciones del corredor compatibles con el vehículo, a más de 50 m de la vía (`minLateralKmToMeasure`), hasta las 24 más cercanas (`maxMatrixStationsPerRoute`);
  - **cómo:** se pide a la Matrix API de Mapbox (perfil `driving`) la ida desde el punto de la ruta más cercano y la vuelta, en lotes de 12 pares (25 coordenadas por consulta), con una consulta de ida y otra de vuelta por lote;
  - **caché:** 7 días.
- **Puerto** `DistanceMatrixProvider` (`domain/ports`), **adaptador** `MapboxMatrixProvider` y **aplicación** `plan-trip/detours.ts`.
- **Snapshot:** el resultado se guarda en `detours` por `ruta|estación`. El navegador y los viajes compartidos recalculan con esos desvíos, sin consultar.
- **Corridor:** `placeOnRoute` usa el desvío medido (distancia y minutos reales, `detourSource: "calculated"`) cuando lo hay; si no, la estimación (`"estimated"`). La parada muestra "por vía" o "estimado".
- **Fallas:** si la matriz falla o un lote falla, esos desvíos quedan estimados y el plan sigue; el log `[detours]` lo dice.

## Consecuencias
- **Costo:** con `matrix`, hasta 4 consultas por ruta (2 lotes × ida y vuelta), y hasta 16 con 4 rutas. La Matrix API cobra por elemento (orígenes × destinos): revisar el plan de Mapbox (O6) antes de activarla. La caché reduce el costo para rutas repetidas.
- **Pendiente:** verificar el límite vigente de coordenadas y el perfil (`driving` vs `driving-traffic`) con un token real. Si el plan de Mapbox cobra mucho por elemento, se puede bajar `maxMatrixStationsPerRoute`.
