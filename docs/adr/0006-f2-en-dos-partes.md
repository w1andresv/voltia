# 0006. F2 en dos partes: estructura ahora, malla y snapshot después

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F2

## Contexto
El plan pone en F2 tres cosas de distinta naturaleza:
1. Que los proveedores solo traigan datos y el dominio haga el muestreo y la elevación (A2). No cambia resultados.
2. Malla de elevación por distancia (100 m), limpieza de túneles y puentes, límite de pendiente y error tipado `ELEVATION_UNAVAILABLE`. Cambia resultados y necesita decidir el presupuesto de consultas (B6).
3. `PlanningSnapshot` en lugar de `GeoBundle`, guardado con los viajes y en el store del navegador. Toca la UI y la persistencia.

## Decisión
- **F2a (hecha):** puertos con datos crudos (`ProviderRoute`, `getElevations`); `engines/route` (muestreo, velocidades, clasificación vial) y `engines/elevation` en el dominio, con la misma aritmética; la política de rutas en `application/plan-trip/route-selection.ts`. El snapshot de caracterización no cambia.
- **F2b (pendiente de B6):** malla por distancia, limpieza, error tipado y proveedor de elevación elegido. Se hace con el modo sombra, porque cambia el consumo en montaña.
- **`PlanningSnapshot` pasa a F8**, junto con `computePlan` en el store: ahí se cambia la persistencia del navegador y de los viajes guardados una sola vez.

## Consecuencias
- Hasta F2b, una falla de elevación deja la ruta plana con un aviso (como hoy), no un error.
- `ProviderRoute` todavía no trae límites de velocidad, congestión ni túneles y puentes: se agregan en F5 (perfil de velocidad) y F2b (limpieza).
- ADR-0005 queda cumplida en su parte de rutas y elevación: los puertos ya tienen la forma del plan §3.1.
