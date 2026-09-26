# 0008. Blaze (Muvatec) como fuente única, detrás de los puertos

- Estado: propuesta (falta mapear los endpoints: la documentación no se pudo leer desde el entorno de desarrollo)
- Fecha: 2026-09-26
- Fase: FB (transversal; ver plan 04 §4)

## Contexto
El dueño del producto definió que la única fuente de datos va a ser la API de Blaze (Muvatec). La documentación está en `https://blaze.muvatec.com/?screen=admin&adminTab=apidocs`. Esa pantalla es del panel de administración y el proxy del entorno de desarrollo bloquea el dominio, así que el detalle de los endpoints está pendiente.

Hoy los datos entran por cinco puertos (`domain/ports`): `StationCatalog`, `RoutingProvider`, `ElevationProvider`, `WeatherProvider` y `GeocodingProvider`. El catálogo de vehículos se lee de Postgres, y el dataset de estaciones sale de fusionar OSM, SIVEEIC, comunidad y catálogo (`infrastructure/stations/sources`).

## Decisión
- Blaze entra **solo por infraestructura**: `src/infrastructure/blaze/` con
  - `client.ts`: HTTP, autenticación, timeouts, reintentos y caché. La URL base y la credencial salen de `getEnv()` (`BLAZE_API_URL`, `BLAZE_API_KEY`) y nunca se registran en logs;
  - `schemas.ts`: zod de las respuestas tal como llegan. Un cambio de la API rompe aquí y no en el dominio;
  - `mappers.ts` (capa anticorrupción): funciones puras de DTO de Blaze a tipos del dominio (`ConsolidatedStation`, `StationConnector`, `Vehicle`, …) que conservan la procedencia (`source: "blaze"`, `powerOrigin`, `currentOrigin`);
  - un adaptador por puerto que Blaze cubra (`BlazeStationCatalog`, y si aplica `BlazeAvailability`, `BlazeVehicleCatalog`, `BlazeRoutingProvider`, …).
- El dominio y los motores no se enteran de que existe Blaze: no se agregan tipos ni campos "de Blaze" al dominio. Si Blaze trae un dato que el dominio no modela (p. ej. disponibilidad por conector en vivo), primero se agrega el concepto al dominio con nombre propio y después el mapper lo llena.
- Lo que Blaze no cubra se queda con el proveedor actual detrás del mismo puerto. "Fuente única" aplica a los datos que Blaze tenga; no se inventan datos para llenar un puerto.
- Selección en `application/container.ts` con `DATA_SOURCE = legacy | blaze` (por defecto `legacy`), igual que `PLANNER_ENGINE`. Con `blaze` y sin credencial, se usa `legacy` y se avisa en el log.
- Puertos nuevos solo si Blaze trae algo que hoy no tiene puerto:
  - `VehicleCatalog` (`list()`, `get(id)`): hoy el catálogo se lee directo de Postgres;
  - `StationAvailability` (`statusOf(ids)`): estado en vivo por estación o conector, separado del catálogo porque cambia cada minuto y el catálogo cada día.

## Alcance decidido (2026-09-26, D9)
Blaze se usa **solo para electrolineras**: un endpoint de listado, que reemplaza el dataset consolidado, y un endpoint de detalle por estación, que se pide solo para las estaciones usadas en la ruta cuando haga falta. Rutas, elevación, clima, geocodificación y vehículos siguen con los proveedores actuales. No se crean `VehicleCatalog` ni adaptadores de rutas o clima para Blaze; sí `BlazeStationCatalog` y un puerto `StationDetails`. Los pasos están en `docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md` §5.7.

## Consecuencias
- Cambiar de fuente o volver atrás es una variable de entorno, sin tocar el dominio.
- Tests: contrato del mapper con respuestas grabadas de Blaze (fixtures sin credenciales, con el mismo `assertNoSecrets` de la cassette), más una caracterización con `DATA_SOURCE=blaze` sobre esos fixtures.
- Si Blaze reemplaza las cinco fuentes de estaciones, la fusión (`merge.ts`, `registry.ts`) y sus fuentes se borran en F9. Mientras tanto quedan detrás de `legacy`.
- **Pendiente:** leer la documentación y llenar la tabla de correspondencia del plan 04 §4 (FB). Hasta entonces el estado es "propuesta".
