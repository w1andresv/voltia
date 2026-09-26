# 0005. Puertos transitorios en F1

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F1

## Contexto
El plan (§3.1) define los puertos con datos crudos: `RoutingProvider.calculateRoutes` devuelve `ProviderRoute` y `ElevationProvider.getElevations(points)` devuelve alturas sueltas. Pero F1 no debe cambiar resultados, y hoy el muestreo de la ruta, el perfil de velocidad y la limpieza de la elevación viven en los proveedores (A2). Mudarlos al dominio es F2.

## Decisión
En F1 los puertos devuelven lo mismo que el código actual:
- `RoutingProvider.routes(waypoints)` → `{ routes: RawRoute[], engine, warnings }`, con la política actual (alternativas, sin peajes, corrección de atajos).
- `ElevationProvider.applyTo(routes)` → rutas con la elevación ya aplicada.
- `WeatherProvider.current(point)` y `StationCatalog.getDataset()` ya tienen su forma final.
- Se agrega `GeocodingProvider` para que `server/actions` no importe proveedores. La geocodificación sigue fuera del motor.

`EVRoutePlanningService` compone con esos puertos y `application/container.ts` es el único que conoce los adaptadores. `PLANNER_ENGINE` existe (por defecto `legacy`); `shadow` y `v2` se atienden con `legacy` y se avisa una vez, hasta que haya motor nuevo.

## Consecuencias
- El test de caracterización (`src/test-support/characterization.test.ts`) no cambió: el servicio da exactamente el resultado del pipeline anterior.
- F2 cambia la firma de `RoutingProvider` y `ElevationProvider` a la del plan §3.1. Solo afecta a los adaptadores y al servicio, no a la UI ni a la acción del servidor.
- Los tipos de `domain/ev/contracts` se crean con cada engine (F2 en adelante), no por adelantado.
