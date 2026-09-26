# Motor de planificación de rutas para vehículos eléctricos: arquitectura

> **Qué es este documento.** Es el traspaso para empezar el desarrollo en otra sesión.
> Lo armé leyendo el código de `voltia` en la rama `main` (commit `d7b3651`).
> La conversación anterior "EV Route Planning Engine architecture" no estaba disponible en esta
> sesión. Si en ella se decidió algo que no aparece aquí, agrégalo en la sección 9 antes de empezar.

---

## 1. Resumen

Voltia planifica viajes en vehículo eléctrico en Colombia. Para una ruta calcula el consumo por
tramo, el estado de carga (SOC) a lo largo del camino y las paradas de recarga, usando **solo
electrolineras verificadas**. Además compara rutas alternativas y las ordena según la estrategia
que eligió el usuario.

- **Stack:** Next.js (App Router, versión con cambios incompatibles: leer `node_modules/next/dist/docs/` antes de tocar APIs de Next), React, TypeScript, TanStack Query, Radix UI, Tailwind 4, Leaflet, Supabase (auth + Postgres), Zod y Vitest.
- **Puerta de entrada:** la server action `planTripFn` en `src/server/actions/plan.ts`.
- **Núcleo puro:** `src/domain/` no tiene I/O. Todo lo que habla con servicios externos está en `src/infrastructure/`.

---

## 2. Capas

```
src/app/                    Páginas (/planificar, /electrolineras, /v/[shareId]) y API routes
src/components/planner/     UI del planificador (trip-panel, itinerary, soc-chart, route-compare…)
src/server/actions/         Server actions: plan.ts, trips.ts, vehicles.ts, stations*.ts, auth.ts
src/infrastructure/         Adaptadores con I/O
  providers/                routing (Mapbox / OSRM), geocode (Photon / Mapbox), elevación y clima (Open-Meteo)
  stations/                 Servicio del dataset consolidado de electrolineras + fuentes (osm, siveeic, catalog, community)
  supabase/, auth/, users/, user-data/, rate-limit.ts, db.ts
src/domain/                 Lógica pura y testeada
  planner.ts                Paradas, recarga de salida, armado del plan y ranking
  energy.ts                 Modelo de consumo por tramo (física o consumo manual)
  charging.ts               Curva de carga, compatibilidad de conectores, adaptadores
  road-hierarchy.ts         Jerarquía vial, atajos por vías menores, tolerancias
  geo.ts                    Haversine, remuestreo, distancia a polilínea, rumbo
  stations/                 Normalizar, deduplicar, fusionar, elegibilidad y búsqueda espacial
  types.ts / schemas.ts     Tipos del dominio; Zod es la fuente de verdad de Vehicle, Place y TripConditions
```

**Regla de dependencias:** `domain` no importa de `infrastructure` ni de `components`. Las
server actions orquestan y cargan los adaptadores con `import()` dinámico.

---

## 3. Flujo de `planTripFn`

```
PlanRequest (origin, waypoints, destination, vehicle, conditions)
  │  rate limit: 20 por minuto por IP
  │  validación con PlanRequestSchema (Zod)
  ▼
fetchRoutes(waypoints)                      infrastructure/providers/routing.ts
  │  Con token de Mapbox: driving-traffic → driving, más una variante sin peajes.
  │    Si Mapbox falla, NO cae a OSRM: el error llega al usuario.
  │  Sin token: OSRM, con un aviso.
  │  Resultado: hasta 4 rutas (MAX_ROUTES), sin duplicados (solape ≥ 90 %),
  │    con alternativas de hasta 1,5× la principal, y roadMix, hierarchyFactor,
  │    minorRoadScore y withinTolerance de cada una.
  ▼
En paralelo:
  applyElevationAll(routes)    Open-Meteo: elevM y slopePct por muestra
  fetchWeather(punto medio)    Temperatura, viento y altura de la celda del pronóstico
  getStationDataset()          Dataset consolidado en memoria (se precarga en instrumentation.ts)
  ▼
findStationsNearRoute(stations, muestras de TODAS las rutas, MAX_FROM_ROUTE_KM = 12)
  → solo las que tienen planning.eligible → toPlanningCharger
  ▼
buildPlan(...) para cada ruta                 domain/planner.ts
  ▼
rankPlans(planes, planningMode)
  ▼
PlanResponse { geo: {routes, chargers, weather, warnings, stationsVersion}, plans, selectedId }
```

Las muestras de la ruta salen cada `max(0,8 km, distancia / 220)` (función `buildSamples` en
`routing.osrm.ts`). Cada tramo de consumo va de una muestra a la siguiente.

---

## 4. Modelo de energía (`domain/energy.ts`)

El detalle completo está en `docs/calculo-consumo-energia.md`. Lo esencial:

- `segmentEnergyKwh(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo)` devuelve los kWh **netos** del tramo. Pueden ser negativos en una bajada.
- Hay dos motores con la misma salida:
  - `physicsSlice`: rodadura, aerodinámica (CdA estimado, densidad del aire según altitud y temperatura, viento proyectado sobre el rumbo), gravedad, eficiencia del tren motriz, auxiliares, clima (A/C) y regeneración limitada por el SOC.
  - `manualSlice`: parte del consumo kWh/100 km que ingresó el usuario y lo ajusta por velocidad, pendiente y condiciones.
- Masa = `weightKg + 75 (conductor) + 75 × pasajeros + equipaje`.
- La temperatura se corrige con la altitud (6,5 °C por km). En Colombia importa mucho: Bogotá está a 2.600 m y el Magdalena casi al nivel del mar.
- `annotateEnergy(samples, ctx, initialSoc)` convierte la lista de muestras en `RouteSample[]` con energía acumulada y SOC.
- `energyBetween(samples, i, j)` da la energía neta entre dos índices. El planificador lo usa en todas partes.

---

## 5. Planificador (`domain/planner.ts`)

### 5.1 `buildPlan` para una ruta

1. **Velocidad:** si el usuario fijó `avgSpeedKmh`, se usa en todas las muestras. Si no, se usa la velocidad de la ruta × `STYLE_SPEED_FACTOR[drivingStyle]`.
2. **`attachChargersToRoute`:** a cada cargador le asigna `nearestSampleIndex`, `nearestKm` y `fromRouteKm`.
3. **`assessFirstCharger`**, la recarga en el origen:
   - Si se llega al destino, o a alguna electrolinera, con el SOC actual → `skip`.
   - Si ni al 100 % se alcanza la primera electrolinera → `impossible` (el plan queda con `FIRST_CHARGER_UNREACHABLE_REASON`).
   - Si no, hace una búsqueda binaria del mínimo de puntos porcentuales extra → `departureCharge`, y el plan se calcula con ese SOC de salida.
   - Primero exige llegar con el margen de seguridad. Solo si ni al 100 % se logra, acepta llegar justo.
4. **`annotateEnergy`** con el SOC de salida que se usará para planear.
5. **`pickStops`**, un algoritmo voraz de hasta 7 paradas (`MAX_STOPS`):
   - Si se llega al destino con `arrivalTarget = max(arrivalSoc, safety)`, no hay paradas.
   - Cargadores usables: `isVerifiedForPlanning`, con un conector compatible (directo o con un adaptador verificado) y ubicados entre el origen y el destino.
   - `collect`: candidatos que están por lo menos 4 km más adelante (`MIN_PROGRESS_KM`) y a los que se llega con el SOC mínimo (primero `safety`; si no hay ninguno, 0 %, o 2 % con `allowBelowSafety`).
   - `narrow`, filtros en cascada: en línea > a ≤ 5 km de la vía (`PREFERRED_FROM_ROUTE_KM`) y con continuación posible > DC > AC > llegada con ≤ 40 % (salvo en `fewer_stops`).
   - `scoreCharger`: penaliza el desvío (el peso depende del modo), la potencia baja, llegar con mucha batería, llegar por debajo del margen, estar fuera de línea u ocupado y el precio. Premia las fuentes PlugShare, SIVEEIC y OSM.
   - `chooseDepart`: a qué SOC cargar. En AC, el mínimo necesario. En DC, depende del modo: tope de 90 % por la caída de la curva, `fewer_stops` ≥ 80 %, `safer` ≥ 70 %, y `fastest` carga solo lo necesario para la siguiente parada más 2 puntos.
   - Cada parada lleva `options` (directo, cada adaptador y AC) y una `alternative` de carga lenta.
6. **`applyStopsToSamples`**, luego el itinerario (origen → cargadores → destino, con minutos acumulados) y al final los totales.

### 5.2 Ranking (`rankPlans`)

El orden de los criterios es:
1. `feasible` primero.
2. `withinTolerance` primero: hasta +15 % de tiempo y +10 % de km frente a la más rápida.
3. El criterio del modo. En todos, la jerarquía vial (`minorRoadScore`) desempata antes:
   - `fastest` / `custom`: `effectiveMinutes` (tiempo total más un recargo por usar vías menores).
   - `efficient`: la menor energía.
   - `fewer_stops`: menos paradas, luego tiempo efectivo.
   - `safer`: el mayor SOC mínimo, luego el mayor SOC de llegada.

### 5.3 Constantes clave

| Constante | Valor | Dónde |
|---|---|---|
| `MAX_STOPS` | 7 | planner.ts |
| `PREFERRED_FROM_ROUTE_KM` | 5 | planner.ts |
| `MAX_FROM_ROUTE_KM` | 12 | planner.ts (lo reutiliza spatial.ts) |
| `MIN_PROGRESS_KM` | 4 | planner.ts |
| `DETOUR_SPEED_KMH` | 50 | planner.ts |
| `MAX_ROUTES` | 4 | routing.ts |
| `MAX_ALTERNATIVE_RATIO` | 1,5 | routing.ts |
| `SAME_ROUTE_OVERLAP` | 0,9 | routing.ts |
| `MAX_EXTRA_TIME_RATIO` / `MAX_EXTRA_DISTANCE_RATIO` | 1,15 / 1,10 | road-hierarchy.ts |
| Margen de seguridad | conservative 20, normal 15, low 10, custom | types.ts `safetyPct` |

---

## 6. Carga (`domain/charging.ts`)

- `DEFAULT_CURVE`: factor de potencia según el SOC. Pleno entre 15 y 40 %, 0,42 al 80 % y 0,08 al 100 %. Cada vehículo puede traer su propia curva.
- `chargeTimeMinutes`: integra en 24 pasos `min(pico del vehículo, kW del cargador) × factor`.
- `VERIFIED_DC_ADAPTERS`: la **única** lista de adaptadores DC que se proponen. No se inventan otras compatibilidades.
- `routePlugs` / `routeSocket`: la mejor forma de conectar, sea directa, con adaptador o en AC.

---

## 7. Electrolineras (dataset consolidado, fase 6)

- Fuentes: `osm`, `siveeic` (MinEnergía), `catalog` (del operador) y `community` (aprobadas).
- Pipeline: normalizar → validar (coordenadas dentro de Colombia) → deduplicar (< 50 m, conectores y texto) → fusionar → elegibilidad.
- Se guarda en Postgres (`0012_station_dataset.sql`), se precarga en memoria al arrancar, un cron de Vercel lo refresca cada 6 h y `/api/stations*` lo expone con ETag.
- **Invariante de seguridad:** el planificador nunca inventa un punto de carga. `isVerifiedForPlanning` descarta los que no tienen nombre, tienen coordenadas inválidas, son privados, están pendientes o rechazados, o vienen del catálogo sin `verified`.

---

## 8. Invariantes que no se deben romper

1. No se proponen paradas en electrolineras no verificadas ni adaptadores fuera de `VERIFIED_DC_ADAPTERS`.
2. Con token de Mapbox, la geometría y la distancia salen siempre de Mapbox. Nada de caer en silencio a OSRM.
3. `distanceKm` del plan es la de la ruta, comparable con Google Maps. El desvío a los cargadores va aparte en `detourKm`, pero sí cuenta en tiempo y energía.
4. El SOC se calcula con energía por tramo, nunca con la autonomía WLTP.
5. `domain/` es puro y determinista: sin fetch, sin `Date.now()` en la lógica y sin variables de entorno.
6. Los tipos `Vehicle`, `Place` y `TripConditions` se derivan de Zod (`schemas.ts`). No se duplican.
7. Los mensajes al usuario van en español y los textos de razones son constantes en `types.ts`.

---

## 9. Decisiones y pendientes de la conversación anterior

> Completar aquí con lo que se acordó en "EV Route Planning Engine architecture":
> alcance, nombres de módulos nuevos, prioridades.

---

## 10. Backlog técnico sugerido (a partir del código actual)

Son propuestas. Hay que priorizarlas al empezar.

1. **Separar `pickStops` (≈ 380 líneas)** en módulos testeables: `candidates.ts` (collect y narrow), `scoring.ts` (scoreCharger), `depart-strategy.ts` (chooseDepart y minimumDepart). `buildPlan` y `rankPlans` deben conservar su API.
2. **Salir del algoritmo voraz y pasar a una búsqueda sobre un grafo:** nodos = (cargador, SOC discretizado cada 5 %), aristas = tramo más carga, costo según el modo. Puede ser un A* o un Dijkstra con poda por SOC. Hay que medirlo contra el voraz en los tests de `planner.test.ts` y con `npm run diagnose:route`.
3. **Tiempo de espera y disponibilidad:** hoy `occupied` solo suma puntos al score. Faltaría modelar una espera esperada en minutos.
4. **Waypoints como paradas obligatorias:** los nodos `via` ya existen en `ItineraryNode` pero `buildPlan` no los emite.
5. **Costo del viaje:** `pricePerKwh` ya existe. Faltaría sumar el costo por parada y en total, y un modo `cheapest`.
6. **Caché de rutas** por (waypoints, perfil) para no volver a pedirle a Mapbox cuando solo cambian el vehículo o las condiciones.
7. **Observabilidad:** hoy solo se registra `[plan-trip]` con console.log. Agregar métricas por etapa (routing, elevación, clima, dataset, planner).
8. **Completar el catálogo de vehículos** (`docs/catalogo-pendientes.md`).

---

## 11. Cómo arrancar la próxima sesión

```bash
npm install
npm run typecheck
npm test                      # vitest + node --test de scripts
npm run dev                   # http://localhost:8080/planificar
npm run diagnose:route        # diagnóstico de una ruta por CLI
```

Tests del motor que sirven de red de seguridad: `src/domain/planner.test.ts`,
`energy.test.ts`, `charging.test.ts`, `road-hierarchy.test.ts` e
`infrastructure/providers/routing.test.ts`.

**Prompt sugerido para la nueva sesión:**

> Lee `docs/arquitectura-motor-rutas.md` y `docs/calculo-consumo-energia.md`. Vamos a trabajar
> en el punto N del backlog (sección 10). Respeta las invariantes de la sección 8. Antes de
> cambiar `planner.ts`, corre `npm test` para tener una línea base.
