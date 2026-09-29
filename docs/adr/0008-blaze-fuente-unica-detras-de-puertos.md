# 0008. Blaze (Muvatec) como fuente única, detrás de los puertos

- Estado: aceptada (2026-09-27): listado y detalle implementados; Blaze solo con el motor v2
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
- Selección en `application/container.ts` según el motor (ver "Implementación": Blaze solo con v2). Sin credencial, se usa `legacy` y se avisa en el log.
- Puertos nuevos solo si Blaze trae algo que hoy no tiene puerto:
  - `VehicleCatalog` (`list()`, `get(id)`): hoy el catálogo se lee directo de Postgres;
  - `StationAvailability` (`statusOf(ids)`): estado en vivo por estación o conector, separado del catálogo porque cambia cada minuto y el catálogo cada día.

## Alcance decidido (2026-09-26, D9)
Blaze se usa **solo para electrolineras**: un endpoint de listado, que reemplaza el dataset consolidado, y un endpoint de detalle por estación, que se pide solo para las estaciones usadas en la ruta cuando haga falta. Rutas, elevación, clima, geocodificación y vehículos siguen con los proveedores actuales. No se crean `VehicleCatalog` ni adaptadores de rutas o clima para Blaze; sí `BlazeStationCatalog` y un puerto `StationDetails`. Los pasos están en `docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md` §5.7.

## Consecuencias
- Cambiar de fuente o volver atrás es una variable de entorno, sin tocar el dominio.
- Tests: contrato del mapper con respuestas grabadas de Blaze (fixtures sin credenciales, con el mismo `assertNoSecrets` de la cassette), más una caracterización del motor v2 con Blaze sobre esos fixtures (pendiente de grabarlos con la key real).
- Si Blaze reemplaza las cinco fuentes de estaciones, la fusión (`merge.ts`, `registry.ts`) y sus fuentes se borran en F9. Mientras tanto quedan detrás de `legacy`.
- **Pendiente:** leer la documentación y llenar la tabla de correspondencia del plan 04 §4 (FB). Hasta entonces el estado es "propuesta".

## Implementación (2026-09-27)
La documentación está en `docs/blaze/api-publica-v1.md`.

### Correspondencia de campos
| Blaze | Dominio (`ConsolidatedStation`) | Nota |
|---|---|---|
| `id` | `id = "blz_" + id`, `sources[0].externalId` | El prefijo evita choques con los ids del dataset consolidado |
| `name` | `name` | |
| `city`, `address` | `address.city`, `address.full` | `address` solo si llega |
| `lat`, `lon` | `lat`, `lon`, `coordSource: "blaze"` | Sin coordenadas (key sin `location:read`) la estación se descarta y se cuenta en `rejected["sin coordenadas"]` |
| `operator` | `operator` | |
| `status` | `availability.value` | `en_servicio` → `available`, `mantenimiento`/`fuera_servicio` → `offline`, `desconocido` o un estado nuevo → `unknown`. "En servicio" es operativa, no "libre": Blaze no publica ocupación |
| `connectors` ("CCS2, Tipo 2") | `connectors[].standard` | Se separa por comas; "Tipo" se lee como "Type" y "CCS 2" como "CCS2", y luego `standardizeConnector` |
| `maxKw` | `connectors[].powerKw` | Es la máxima de la estación. Con DC, va a los conectores DC (`reported`) y los AC toman la del estándar acotada a `maxKw` (`assumed`). Con solo AC (≤ 43 kW), va a los AC. Sin `maxKw`, la del estándar |
| `chargersCount` | `connectors[].quantity` | Solo si hay un único tipo de conector; si no, `null` |
| `verified`, `status`, `maxKw`, `chargersCount` | `attributes.blaze` | Crudos, para diagnóstico |
| detalle `chargers[]` | `connectors[]` por estándar | `quantity` = número de cargadores, `powerKw` = el máximo, `status` = `available` si alguno está en servicio, `offline` si todos están fuera o en mantenimiento. Si ningún cargador está en servicio, la estación queda `offline` |

- Los conectores de Blaze cuentan como **confirmados**, porque es la fuente oficial del operador, y `access` es `public`.
- La elegibilidad para planificar es la misma de siempre (`evaluateEligibility`).

### Código
- `src/infrastructure/blaze/`:
  - `schemas.ts`: zod tolerante; solo `id` y `name` son obligatorios, porque lo demás depende de los scopes;
  - `mappers.ts`: funciones puras;
  - `client.ts`: key en la cabecera `X-API-Key`; listado en caché 15 min y detalle 2 min;
  - `catalog.ts`: `BlazeStationCatalog` y `BlazeStationDetails`.
- **Puerto nuevo:** `src/domain/ports/station-details.ts` (`get(id)`).
- **Selección** (`container.ts`):
  - **Blaze solo con el motor v2** (decisión del dueño del producto, 2026-09-27). El motor es el de la URL del planificador (`/v1` o `/v2`) o, si el usuario no puede elegir, `PLANNER_ENGINE`;
  - v1 y el modo sombra siguen con el dataset consolidado;
  - v2 sin `BLAZE_API_KEY` también, con un aviso en el log;
  - `DATA_SOURCE` se descartó: la fuente la decide el motor.
  - **Mapa:** `/api/stations?engine=v1|v2` devuelve el listado del motor elegido. El navegador lo pide según el motor de la página, así que el mapa y el plan muestran las mismas estaciones. El de Blaze no va a las cookies de 6 h: se refresca cada 15 min.
  - **Detalle:** `/api/stations/{id}` pide el detalle a Blaze solo para ids `blz_…`.
- **Planificación** (`plan-trip/stop-details.ts`):
  - después de elegir el plan recomendado, se pide el detalle **solo de sus paradas** (en paralelo, 5 s como máximo);
  - si una parada no tiene ningún cargador en servicio, se marca `offline` y se replanifica una vez (los dos planificadores descartan las `offline`), con un aviso al usuario;
  - si el detalle trae potencias distintas, también se replanifica;
  - si el detalle falla, se sigue con el listado.
- **UI:** la ficha de una estación de Blaze pide el detalle al abrirse y muestra el estado de cada tipo de cargador (`live-charger-status.tsx`). El popup del mapa no lo pide, para no gastar el cupo por minuto. `/api/stations/{id}` limita a 30 consultas de detalle por IP y minuto (tabla `rate_limits`); pasado el límite, responde con la estación del listado sin llamar a Blaze.
- **Si Blaze falla:** se sirve el último listado bueno del proceso, marcado como viejo, y el planificador avisa. Sin listado previo, la planificación falla con un error claro.
- **Prueba con la key real:** `npm run blaze:check` muestra cuántas estaciones llegan, qué campos trae cada scope, los estados, las etiquetas de conector, los campos no documentados y un detalle.

### Pendiente
- Correr `npm run blaze:check` con la key real y ajustar el esquema o los traductores si algo llega distinto (etiquetas de conector, campos extra, paginación).
- **Navegador:** el mapa guarda el listado 6 h en cookies (`station-dataset-cookies`). Con Blaze, el estado del mapa puede tener hasta 6 h de retraso. La planificación usa el del servidor (15 min) y el detalle de las paradas (2 min).
- **F9:** cuando v2 sea el motor por defecto y Blaze esté estable, borrar las fuentes del dataset consolidado, la fusión y el cron de refresco.

## Paradas nuevas tras el detalle (2026-09-29)
Si el detalle de las paradas cambia el plan (p. ej. una estación fuera de servicio), el plan recalculado puede parar en estaciones que no se consultaron. Ahora hay una segunda vuelta que pide el detalle solo de esas paradas nuevas (`checkStopDetails` con `skip`); como mucho dos vueltas (`STOP_DETAIL_ROUNDS` en `service.ts`), así una estación nunca se consulta dos veces y el tiempo sigue acotado.
