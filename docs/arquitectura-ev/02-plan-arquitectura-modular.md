# Plan de arquitectura modular del motor de rutas EV

Plan para llevar el planificador de Voltia a la arquitectura del "EV Route Planning Engine v2" sin reescribir la app ni romper lo que funciona. Se basa en la revisión [`01-feedback-codigo-vs-plan.md`](./01-feedback-codigo-vs-plan.md); los códigos C1–C8, D1–D12 y A1–A8 remiten a ella.

## 0. Punto de partida

**Se conserva tal cual:**

- el pipeline de electrolineras (`src/infrastructure/stations`, `src/domain/stations`): es el "listado existente";
- la jerarquía vial y la corrección de atajos (`src/domain/road-hierarchy.ts`);
- el modelo de aire (densidad, gradiente térmico, viento) y el de climatización por nivel;
- el modo de consumo manual, como un modelo de energía alternativo;
- usuarios, auth, viajes guardados y la UI (a través de un adaptador durante la migración);
- el recálculo instantáneo en el cliente, formalizado como una función pura.

**Se cambia:**

- el planificador monolítico (`planner.ts`) se divide en engines con contratos;
- energía y SOC se separan;
- los proveedores solo traen datos; el muestreo, la velocidad y las pendientes pasan al dominio;
- entran puertos, un servicio de aplicación y un punto único de composición;
- los multiplicadores de estilo, ciclo y clima dejan su lugar al perfil de velocidad y a parámetros con fuente.

**Estrategia:** migración incremental con el motor nuevo en paralelo (`src/domain/ev`), comparado contra el actual con fixtures y en modo sombra, hasta reemplazarlo.

---

## 1. Principios

1. **Una pregunta por engine** (tabla en la sección 4.13).
2. **Solo los adaptadores de `src/infrastructure` hacen I/O.** Los engines son funciones puras: sin red, sin reloj, sin aleatoriedad, sin estado global.
3. **Los engines no se importan entre sí.** Comparten tipos a través de `contracts/`; los compone `computePlan` (puro) y el servicio de aplicación (con I/O).
4. **Una sola fuente de verdad:** el consumo se calcula una vez; SOC, paradas, viabilidad y gráficas derivan de ahí.
5. **Unidades en el nombre** (`distanceKm`, `speedKmh`, `energyKwh`); SI dentro de las fórmulas; conversiones en `core/units.ts`.
6. **Sin redondeo en el dominio**, salvo la carga previa, que se redondea hacia arriba a puntos enteros por decisión de producto (documentada).
7. **Determinismo:** mismo `PlanningSnapshot` + mismas entradas ⇒ mismo resultado. Los datos externos entran solo por el snapshot.
8. **Trazabilidad:** todo parámetro físico es un `SourcedValue` (`manufacturer`, `external_source`, `calculated`, `estimated`, `configurable`).
9. **Parámetros centralizados y versionados** en `ModelParameters` (`modelVersion`).
10. **Error ≠ no viable:** un fallo de proveedor es un error tipado; nunca una ruta plana en silencio ni un "no viable".

---

## 2. Arquitectura objetivo

### 2.1 Capas y carpetas

```text
src/
  domain/
    ev/                              ← motor nuevo: puro e isomórfico (servidor y navegador)
      contracts/                     ← solo tipos compartidos entre engines
        route.ts elevation.ts speed.ts energy.ts soc.ts stations.ts
        charging.ts feasibility.ts plan.ts vehicle.ts trip.ts snapshot.ts
      core/
        units.ts provenance.ts params.ts axis.ts      ← eje de distancia, remuestreo, interpolación
        trip-config.ts                                ← TripConditions + Vehicle → TripConfiguration
      engines/
        route/          normalize.ts                  ← ProviderRoute → Route (eje canónico, segmentos)
        elevation/      engine.ts
        speed/          engine.ts
        energy/         engine.ts physics.ts manual-model.ts air.ts hvac.ts vehicle-params.ts
        soc/            simulate.ts
        corridor/       engine.ts
        compatibility/  engine.ts
        charging/       curve.ts planner.ts
        feasibility/    engine.ts
        chart/          series.ts
      compute-plan.ts                ← composición pura (pasada 1)
      legacy-adapter.ts              ← EVRoutePlan → RoutePlan, temporal para la UI actual
    ports/                           ← interfaces de proveedores externos
      routing.ts elevation.ts weather.ts station-catalog.ts
    road-hierarchy.ts                ← sin cambios
    stations/ user/ auth/            ← sin cambios (salvo C4 y C7 en stations)
  application/                       ← nuevo: casos de uso con I/O
    plan-trip/
      gather-inputs.ts               ← llama a los puertos → PlanningSnapshot
      route-selection.ts             ← política de rutas: alternativas, sin peajes, corrección de atajos
      verify-plan.ts                 ← pasada 2: reruteo por las paradas y verificación
      service.ts                     ← EVRoutePlanningService
    container.ts                     ← composición: qué adaptador implementa cada puerto
  infrastructure/providers/
    routing/    mapbox.ts mapbox.schema.ts osrm.ts osrm.schema.ts
    elevation/  mapbox-terrain.ts open-meteo.ts opentopodata.ts with-fallback.ts
    weather/    open-meteo.ts
    stations/   station-catalog.ts   ← adapta getStationDataset() al puerto
  server/actions/plan.ts             ← valida, limita tasa y llama a service.plan()
  lib/store.ts                       ← llama a computePlan(snapshot, …) al cambiar condiciones
```

Nombre a evitar: ya existe `StationSource` (fuentes del dataset en `infrastructure/stations/sources/types.ts`). El puerto que consume el planificador se llama `StationCatalog`.

### 2.2 Reglas de dependencia

| Capa | Puede importar | No puede importar |
|---|---|---|
| `domain/ev/contracts`, `domain/ev/core` | `domain/types`, `domain/stations/model` (tipos) | engines, infraestructura, aplicación, `next`, React |
| `domain/ev/engines/*` | `contracts`, `core`, `domain/road-hierarchy` | otros engines, `ports`, infraestructura, `next`, React |
| `domain/ev/compute-plan.ts` | engines, `contracts`, `core` | `ports`, infraestructura |
| `domain/ports` | `domain/ev/contracts`, tipos de `domain` | todo lo demás |
| `application` | `domain/**`, `domain/ports` | `infrastructure` (salvo `container.ts`), React |
| `infrastructure` | `domain/**` (tipos y puertos) | `application`, React |
| `server/actions`, `lib/store`, `components` | `application` (servidor), `domain/ev/compute-plan` y `contracts` (cliente) | adaptadores de infraestructura directamente |

Se hace cumplir con ESLint (`eslint.config.mjs`). Los patrones del dominio se repiten en el bloque de engines porque en la configuración plana el último bloque que coincide reemplaza la regla:

```js
const OUTSIDE_DOMAIN = [
  { group: ["@/infrastructure/*", "@/application/*", "@/server/*", "@/lib/*", "@/components/*"],
    message: "El dominio no depende de capas externas." },
  { group: ["next", "next/*", "react", "react-dom", "server-only"],
    message: "El dominio es TypeScript puro." },
];

// dentro de tseslint.config(...)
{
  files: ["src/domain/**/*.ts"],
  rules: { "no-restricted-imports": ["error", { patterns: OUTSIDE_DOMAIN }] },
},
{
  files: ["src/domain/ev/engines/**/*.ts"],
  ignores: ["**/*.test.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [
      ...OUTSIDE_DOMAIN,
      // Dentro de un engine: "./archivo" para lo propio y "@/domain/ev/contracts|core/…" para lo compartido.
      { group: ["../*", "@/domain/ev/engines/*"],
        message: "Un engine no importa otro engine: los compone compute-plan.ts." },
      { group: ["@/domain/ports/*"], message: "Los engines no conocen proveedores." },
    ]}],
  },
},
{
  files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.ts", "src/server/**/*.ts"],
  ignores: ["src/components/user/**", "src/components/auth/**"],   // hoy usan adaptadores de auth; fuera de alcance
  rules: {
    "no-restricted-imports": ["error", { patterns: [
      { group: ["@/infrastructure/providers/*"],
        message: "Los proveedores se usan a través de application/." },
    ]}],
  },
},
```

### 2.3 Flujo

```text
SERVIDOR (I/O)                                   SERVIDOR y NAVEGADOR (puro)

server/actions/plan.ts
  └─ service.plan(request)
       ├─ gatherInputs()  ──────────────► PlanningSnapshot
       │    RoutingProvider   (rutas, alternativas, sin peajes, atajos)
       │    ElevationProvider (elevación cruda en la malla del dominio)
       │    WeatherProvider   (condiciones)
       │    StationCatalog    (dataset versionado)
       │    RoutingProvider.matrix (desvíos, si hay capacidad)
       │
       ├─ computePlan(snapshot, vehicle, trip, params)  ◄── también lo llama lib/store.ts
       │    por ruta: normalize → elevation → speed → energy → soc
       │              → corridor → compatibility → planner → feasibility → chart
       │    ranking de rutas
       │
       └─ verifyPlan(plan elegido)       (pasada 2, solo en servidor)
            RoutingProvider con las paradas como waypoints
            ElevationProvider sobre la ruta real
            computePlan con paradas fijas → verificado o replanificar (máx. 3)
```

- **Pasada 1** (`computePlan`) sale del snapshot y es la que el store recalcula al instante cuando el usuario cambia condiciones.
- **Pasada 2** (`verifyPlan`) necesita red y corre en el servidor al pedir el plan, al guardar y al compartir. La UI marca el plan como "verificado" cuando termina.
- El `PlanningSnapshot` reemplaza al `GeoBundle` actual (que ya es casi eso) y se guarda con el viaje, para que un viaje guardado o compartido se pueda recalcular igual.

---

## 3. Contratos

### 3.1 Puertos

```ts
// src/domain/ports/routing.ts
export interface RouteRequest {
  waypoints: LatLon[];                       // origen, intermedios, destino
  alternatives: boolean;
  avoid?: { tolls?: boolean; points?: LatLon[] };
  departureTime?: string;                    // ISO 8601
}

/** Lo que devuelve el proveedor, sin muestreo ni modelo. */
export interface ProviderRoute {
  provider: string;                          // "mapbox" | "osrm" | …
  profile: string;
  snapshotId: string;                        // hash de la respuesta cruda
  geometry: LatLon[];                        // completa, sin reducir
  distanceM: number;
  durationS: number;
  legs: { distanceM: number; durationS: number; summary?: string }[];
  /** Por par de puntos consecutivos de la geometría, si el proveedor las da. */
  annotations?: {
    distanceM: number[];
    durationS: number[];
    speedLimitKmh?: (number | null)[];
    congestion?: ("low" | "moderate" | "heavy" | "severe" | "unknown")[];
  };
  /** Clase vial y marcas por tramo de geometría (desde intersecciones o pasos). */
  roadAttributes?: { fromIndex: number; toIndex: number; roadClass?: string;
                     tunnel?: boolean; bridge?: boolean; toll?: boolean }[];
  waypointSnapKm: number[];
}

export interface RoutingProvider {
  readonly id: string;
  readonly capabilities: {
    alternatives: boolean; avoidTolls: boolean; avoidPoints: boolean;
    speedLimits: boolean; congestion: boolean; roadClasses: boolean; matrix: boolean;
  };
  calculateRoutes(request: RouteRequest): Promise<ProviderRoute[]>;
  matrix?(from: LatLon[], to: LatLon[]): Promise<{ distanceM: number[][]; durationS: number[][] }>;
}
```

Un solo `calculateRoutes` con `alternatives` en vez de dos métodos (el plan v2 tenía `calculateRoute` y `calculateAlternativeRoutes`): Mapbox devuelve la principal y las alternativas en la misma llamada, y así no se paga dos veces.

```ts
// src/domain/ports/elevation.ts
export interface ElevationProvider {
  readonly id: string;
  readonly nominalResolutionM: number;       // 30, 90…
  readonly surfaceModel: "DSM" | "DTM";      // Copernicus es DSM (incluye vegetación y edificaciones)
  getElevations(points: LatLon[]): Promise<(number | null)[]>;   // el adaptador agrupa en lotes
}

// src/domain/ports/weather.ts
export interface WeatherProvider {
  getConditions(points: LatLon[], at?: string): Promise<WeatherSnapshot[]>;
}

// src/domain/ports/station-catalog.ts
export interface StationCatalog {
  getDataset(): Promise<{ version: string; stations: ConsolidatedStation[] }>;
}
```

### 3.2 Snapshot

```ts
// src/domain/ev/contracts/snapshot.ts
export interface PlanningSnapshot {
  schemaVersion: 1;
  createdAt: string;
  providers: { routing: string; elevation: string; weather: string | null };
  routes: {
    route: ProviderRoute;
    meta: { label: string; noTolls?: boolean; roadMix?: RoadMix; hierarchyFactor?: number;
            withinTolerance?: boolean; minorRoadScore?: number };
    elevationGridKm: number[];               // malla pedida por el dominio
    elevationM: (number | null)[];           // cruda, del proveedor
  }[];
  weather: WeatherSnapshot[] | null;
  stationsVersion: string;
  stations: ConsolidatedStation[];           // solo las del corredor de alguna ruta
  detours?: Record<string, { distanceKm: number; durationMin: number; source: DataSource }>;
}
```

Ya existe casi todo en `GeoBundle` (`domain/types.ts:249-256`). Se agregan la geometría completa, la elevación cruda, las anotaciones y los ids de proveedor, y se quita el muestreo (que pasa al dominio).

### 3.3 Vehículo: evolución compatible del esquema

`VehicleSchema` se guarda como JSON en `public.voltia_vehicles`. Todo lo nuevo es **opcional**, así los vehículos guardados siguen siendo válidos:

```ts
const DataSourceSchema = z.enum(["manufacturer", "external_source", "calculated", "estimated", "configurable"]);
const Sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, source: DataSourceSchema, reference: z.string().optional(), notes: z.string().optional() });

export const VehicleSchema = z.object({
  /* …campos actuales sin cambios… (batteryKwh sigue siendo la capacidad ÚTIL, convención del seed) */
  grossBatteryKwh: Sourced(z.number().positive()).optional(),
  physics: z.object({
    dragCoefficient: Sourced(z.number().positive()).optional(),
    frontalAreaM2: Sourced(z.number().positive()).optional(),
    rollingResistance: Sourced(z.number().positive()).optional(),
    drivetrainEfficiency: Sourced(z.number().min(0.5).max(1)).optional(),
    regenEfficiency: Sourced(z.number().min(0).max(1)).optional(),
    maxRegenPowerKw: Sourced(z.number().positive()).optional(),
    rotationalInertiaFactor: Sourced(z.number().min(1).max(1.2)).optional(),
    baseAuxKw: Sourced(z.number().min(0)).optional(),
    bodyType: z.enum(["hatchback", "sedan", "suv", "pickup", "van"]).optional(),
  }).optional(),
  /** Fuente de los campos existentes (batteryKwh, weightKg, dcMaxKw…), hoy en comentarios SQL. */
  provenance: z.record(z.string(), z.object({ source: DataSourceSchema, reference: z.string().optional() })).optional(),
  adapters: z.array(ChargeAdapterSchema).optional(),   // ya existe: pasa a significar "adaptadores que llevo"
});

export const ChargeAdapterSchema = z.object({
  from: ConnectorTypeSchema,                  // lado estación
  to: ConnectorTypeSchema,                    // lado vehículo
  current: z.enum(["AC", "DC"]).default("DC"),
  maxPowerKw: z.number().positive().optional(),
});
```

`engines/energy/vehicle-params.ts` resuelve cada parámetro a un `SourcedValue`:

| Parámetro | Si el vehículo lo trae | Si no (respaldo, marcado `estimated`) |
|---|---|---|
| Cd × área | `physics.dragCoefficient × physics.frontalAreaM2` | Tabla por `bodyType` en `ModelParameters`. Mientras no exista `bodyType`, la heurística actual por peso (`energy.ts:117`) **sin** el término de potencia. |
| Crr | `physics.rollingResistance` | Valor por defecto en `ModelParameters` |
| Eficiencia de tracción | `physics.drivetrainEfficiency` | Constante por defecto (hoy sale de `motorKw`, que el plan prohíbe) |
| Eficiencia de regeneración | `physics.regenEfficiency` | Constante por defecto |
| Potencia máx. de regeneración | `physics.maxRegenPowerKw` | Valor por defecto por segmento de vehículo (hoy 40 % de `motorKw`) |
| Factor de inercia rotacional | `physics.rotationalInertiaFactor` | 1,05 |
| Auxiliares base | `physics.baseAuxKw` | 0,45 kW (valor actual) |

`motorKw` queda como dato informativo. Todo valor por defecto vive en `ModelParameters` con su `SourcedValue` y el plan final lista cuáles se usaron.

### 3.4 Condiciones del viaje → configuración

`core/trip-config.ts` traduce `TripConditions` (sin cambiar su esquema ni la UI) a una `TripConfiguration` explícita. Es la única fuente de los pisos de SOC, y la usan el planificador y el panel de batería (corrige C8).

| `TripConfiguration` | Sale de | Nota |
|---|---|---|
| `initialSocPercent` | `initialSoc` | |
| `occupantsMassKg` | `DRIVER_KG + passengers × PERSON_KG` | Semántica actual: el conductor siempre va |
| `luggageMassKg` | `luggageKg` | |
| `drivingMode` | `drivingStyle` | |
| `regenerationMode` | `regenLevel` | |
| `hvacMode` | `ac` (`off` / `eco` / `normal` / `max`) | Se conservan los 4 niveles, más ricos que el booleano del plan v2 |
| `ambient.temperatureC` | `temperatureC ?? clima` | Con la corrección por altitud actual |
| `ambient.wind` | clima | Ya modelado |
| `cruiseSpeedKmh` | `avgSpeedKmh` | Velocidad fija: pasa a ser un modo del perfil de velocidad |
| `minimumSocPercent` | `allowBelowSafety ? 2 : max(safetyPct, vehicle.minSocRecommended)` | Piso en **todo** punto (C1). **Decisión abierta:** si `minSocRecommended` entra al piso o solo informa |
| `destinationReserveSocPercent` | `max(arrivalSoc, piso)` | |
| `maxChargeTargetSocPercent` | `vehicle.maxSocTravel` | |
| `planningEnergyMarginPercent` | nuevo, `ModelParameters` | 0 al inicio para no cambiar resultados; se sube tras calibrar |
| `objective` | `planningMode` | Ver 4.9 |
| `adapters` | `vehicle.adapters` | Los que el usuario marca que lleva (C4) |

### 3.5 Resultado

`EVRoutePlan` del plan v2, con estos agregados de Voltia: `label`, `via`, `noTolls`, `roadMix`, `hierarchyFactor`, `withinTolerance`, `minorRoadScore`, `engine`, `itinerary`, `warnings` (códigos), `assumptions`, `dataQuality`, `verified: boolean`, `snapshotId`, `modelVersion`.

Durante la migración, `legacy-adapter.ts` convierte `EVRoutePlan → RoutePlan` para que los componentes actuales (`soc-chart`, `consumption-chart`, `itinerary`, `stats`, `route-compare`, `export-gps-button`) sigan funcionando sin cambios. Al final de la migración los componentes leen `EVRoutePlan` y el adaptador se borra.

---

## 4. Engines

Cada engine: qué pregunta responde, qué recibe y devuelve, de dónde sale el código actual y qué cambia. Las fórmulas físicas completas y los tipos de salida detallados son los del plan v2 (secciones 5.2–5.10); aquí va lo específico de Voltia.

### 4.1 Normalización de ruta — `engines/route/normalize.ts`

**Pregunta:** ¿cuál es la ruta, sobre un eje de distancia único?

- **Entra:** `ProviderRoute` + `meta`.
- **Sale:** `Route` con `geometry`, `axisKm` (distancia geodésica acumulada, haversine de `geo.ts`), `distanceKm`, `providerDistanceKm`, `providerDurationMin`, `segments` (límite de velocidad, velocidad típica, congestión, clase vial, túnel, puente, peaje) y `legs`.
- **Viene de:** `buildSamples` y `viaOf` en `routing.osrm.ts:164-231` (el muestreo sale del proveedor).
- **Cambia:**
  - Se usa la geometría completa. El `downsample(…, 420)` actual queda solo para dibujar el mapa.
  - Hoy `km` se reescala a la distancia del proveedor (`routing.osrm.ts:197`). En el eje canónico se usa la distancia geodésica y la diferencia va a `dataQuality`.

**Política de rutas** (`application/plan-trip/route-selection.ts`, con I/O): lo que hoy hace `fetchRoutes` (`routing.ts:205-298`): alternativas, variante sin peajes, corrección de atajos con `avoid.points`, deduplicación y tolerancias, fallback de perfil. Se mueve casi sin cambios, pero llamando al puerto en vez de a `fetchMapboxCandidates`. Si el proveedor no tiene `avoidPoints` (OSRM), la corrección de atajos se omite, igual que hoy.

### 4.2 Elevación — `engines/elevation/engine.ts`

**Pregunta:** ¿cómo cambia la altitud a lo largo de la ruta?

- **Entra:** `Route`, la elevación cruda del snapshot (en la malla que pidió el dominio) y `Route.segments` (túneles y puentes).
- **Sale:** `ElevationProfile` (plan v2 §5.2), con `rawElevationM`, `elevationM` limpia, pendiente por tramo, ascenso y descenso totales y `dataQuality`.
- **Viene de:** `applyElevation`, `interpolateElev` y `smoothSeries` (`elevation.openmeteo.ts:48-118`). El adaptador queda reducido a `getElevations(points)`.
- **Cambia:**
  - **Malla por distancia, no por número fijo de puntos.** Hoy son 96 puntos por ruta: uno cada ~2,2 km en Piedecuesta → Vélez. Valor por defecto: 100 m (Open-Meteo usa un modelo de 90 m; muestrear más fino no aporta).
  - **Limpieza:** interpolación lineal en túneles y puentes, suavizado por distancia (ventana de 150–300 m, no "5 muestras"), límite de pendiente configurable, conteo de puntos recortados.
  - **Sin datos no es 0 m.** Si falta un tramo se interpola con aviso; si falta todo, error tipado `ELEVATION_UNAVAILABLE`. El planificador no se ejecuta con una ruta plana inventada.
- **Presupuesto de consultas:** a 100 m, una ruta de 212 km son ~2.100 puntos. Con el límite de 100 puntos por consulta de Open-Meteo son ~22 consultas por ruta, y hasta 4 rutas. Opciones, en orden:
  1. `MapboxTerrainElevationProvider`: decodifica teselas de terreno de Mapbox en el servidor con caché persistente. Una ruta toca unas decenas de teselas, reutilizables entre usuarios. Revisar la cuota vigente.
  2. Open-Meteo con malla adaptativa: 100 m donde la pendiente cambia y 300 m en llano, con un tope de consultas.
  3. OpenTopoData como respaldo (ya existe).

### 4.3 Perfil de velocidad — `engines/speed/engine.ts`

**Pregunta:** ¿a qué velocidad y con qué aceleraciones se espera circular?

- **Entra:** `Route` (segmentos, geometría), `drivingMode`, `cruiseSpeedKmh` y `ModelParameters.speed`.
- **Sale:** `SpeedProfile` en la malla fina (velocidad, aceleración por tramo, velocidad objetivo, factor limitante) y duración estimada.
- **Viene de:** `speedProfile`, `timeAtKm` y `applySegmentSpeeds` (`routing.osrm.ts:92-162`) y el factor de estilo (`planner.ts:741-747`).
- **Algoritmo** (plan v2 §5.3):
  - velocidad esperada = min(límite ?? tabla por clase vial, velocidad típica del proveedor);
  - límite por curvatura;
  - objetivo según el modo;
  - pasadas hacia adelante y hacia atrás con aceleración y frenado máximos del modo;
  - velocidad 0 en origen, destino y paradas.
- **Velocidad fija del usuario** (`avgSpeedKmh`): pasa a ser el objetivo, respetando curvas y aceleraciones. No vuelve a ser una velocidad constante irreal en curvas de montaña.
- **Transición:** si el proveedor no da límites ni clases viales (OSRM), el objetivo es la velocidad típica por tramo, como hoy, y se agregan aceleración y curvatura.
- **Calibración:** se reporta la desviación entre la duración resultante y la del proveedor (`dataQuality`). Sin reescalar en silencio.
- **Anotaciones a pedir a Mapbox:** `distance,duration,speed,maxspeed,congestion` (verificar formato y disponibilidad en la documentación vigente; `congestion` requiere el perfil con tráfico, que hoy no se usa por la razón de `routing.mapbox.ts:7-11`).

### 4.4 Energía — `engines/energy/`

**Pregunta:** ¿cuánta energía consume o recupera cada segmento?

- **Entra:** vehículo resuelto (`vehicle-params.ts`), `TripConfiguration`, `Route`, `ElevationProfile`, `SpeedProfile`, `ModelParameters`.
- **Sale:** `EnergyProfile` (plan v2 §5.4): segmentos de 200 m por defecto (configurable 100–500 m) con fuerzas, energía de rueda, tracción, auxiliares, regeneración **potencial**, freno de fricción y neto.
- **Se conserva de `energy.ts`:** `airDensity`, `segmentTempC`, `airSpeedSq` (van a `air.ts`), `acPowerKw` y el factor de calefacción/enfriamiento por temperatura (van a `hvac.ts`), auxiliares cobrados siempre, gravedad con signo.
- **Se elimina:**
  - `STYLE_MULT` y `STYLE_SPEED_FACTOR` (el modo actúa en el perfil de velocidad);
  - `CYCLE_OVERHEAD` (1,14): lo reemplazan la aceleración, la curvatura y el frenado del perfil;
  - `climateMultiplier` sobre la tracción: el efecto de la temperatura sobre batería y llantas pasa a un `EfficiencyModel` explícito con parámetros `estimated`, o se retira si la calibración no lo justifica;
  - `effectiveRegen(socPct)`: el recorte por SOC pasa al SOCEngine (C6);
  - la dependencia de `motorKw` (D2).
- **Modelos intercambiables:**
  - `PhysicsEnergyModel`: por defecto.
  - `ManualConsumptionModel`: el modo manual actual (`manualSlice`), para quien fija su consumo. Mantiene la separación "base + efecto de pendiente" pero sin el multiplicador de estilo, y marca en `assumptions` que el consumo es del usuario.
- **Transición sin saltos:** mientras el perfil de velocidad no esté listo (fase F5), el engine nuevo puede correr con un `LegacyCycleFactor` explícito, marcado `estimated` y listado en `assumptions`, para comparar contra el motor actual. Se borra en F6.

### 4.5 SOC — `engines/soc/simulate.ts`

**Pregunta:** ¿cómo evoluciona la batería?

- **Entra:** `EnergyProfile`, capacidad útil (`batteryKwh`), SOC inicial, eventos de carga y de energía (desvíos), piso, margen de planificación y la política de regeneración con batería llena.
- **Sale:** `SOCProfile` (plan v2 §5.5): puntos, mínimo y dónde ocurre, llegada, violaciones, `maxDeficitKWh` y regeneración recortada.
- **Viene de:** el bucle de `annotateEnergy` (`energy.ts:371-419`), `applyStopsToSamples` (`planner.ts:561-577`) y `effectiveRegen` (`energy.ts:139`).
- **Cambia:**
  - la regeneración aceptada se recorta por SOC aquí (se conserva la rampa actual: completa hasta 80 %, cero desde 98 %, como parámetros);
  - no se recorta por debajo de 0, para medir el déficit;
  - las cargas y los desvíos son eventos de la simulación (corrige C2);
  - el piso se evalúa en cada punto (corrige C1).

### 4.6 Corredor de estaciones — `engines/corridor/engine.ts`

**Pregunta:** ¿dónde queda cada estación del listado respecto a la ruta?

- **Entra:** `Route`, estaciones elegibles del snapshot, desvíos medidos (`snapshot.detours`) y `ModelParameters.corridor`.
- **Sale:** `RouteStationCandidate[]` con distancia a lo largo de la ruta, distancia lateral y desvío con su fuente (`calculated` si viene de la matriz del proveedor; `estimated` si sale de 2 × lateral × factor vial).
- **Unifica** `findStationsNearRoute` (`stations/spatial.ts`) y `attachChargersToRoute` (`planner.ts:58-81`); corrige D7.
- **Cambia:** la distancia se mide contra los segmentos de la geometría (no contra muestras) con prefiltro por caja. El umbral de 12 km (`MAX_FROM_ROUTE_KM`) pasa a `ModelParameters`.
- **Servidor:** `gatherInputs` pide los desvíos reales con `RoutingProvider.matrix` para las estaciones del corredor, en lotes, si el proveedor lo permite. Esto hace que la pasada 1 del cliente ya use desvíos medidos.

### 4.7 Compatibilidad — `engines/compatibility/engine.ts`

**Pregunta:** ¿puede este vehículo cargar aquí y con qué adaptador?

- **Entra:** puertos del vehículo (derivados de `connectors` + `acMaxKw` / `dcMaxKw`), `vehicle.adapters` y conectores de la estación **con su tipo de corriente**.
- **Sale:** `CompatibilityResult` (plan v2 §5.7) con todas las opciones, la mejor, el factor limitante y la fuente de la potencia.
- **Viene de:** `routePlugs`, `routeSocket`, `effectiveChargeKw` y `directAcSocket` (`charging.ts:67-131`).
- **Cambia (C4, C7):**
  - Los adaptadores salen de `vehicle.adapters`, intersectados con `VERIFIED_DC_ADAPTERS` (solo combinaciones seguras).
  - El editor de vehículo muestra casillas "llevo este adaptador" en vez del texto informativo de `vehicle-editor.tsx:322-332`.
  - `ChargerSocket` gana `current` y `powerSource` (`reported` / `assumed`). `toPlanningCharger` deja de descartar el tipo de corriente.
  - Un GB/T de AC no se empareja con un adaptador de DC.
  - Límite de potencia del adaptador.
  - Potencia asumida visible como `estimated`.

### 4.8 Curva de carga — `engines/charging/curve.ts`

**Pregunta:** ¿cuánto tarda cargar de A a B en esta toma?

- **Viene de:** `chargeTimeMinutes` y `lerpFactor` (`charging.ts:20-54`).
- **Corrige C3:** `P(soc) = min(dcMaxKw × factor(soc), potencia disponible de la toma)`.
- **Integración:** en pasos de SOC (0,5 %), más `connectionOverheadMin`.
- **Otros cambios:**
  - AC plano, limitado por el cargador a bordo (como hoy con `FLAT_CURVE`).
  - `DEFAULT_CURVE` es genérica (el seed lo dice); se marca `estimated` y `chargingTimeSource: "estimated_curve"`.

### 4.9 Planificador de carga — `engines/charging/planner.ts`

**Pregunta:** ¿dónde paro y cuánto cargo?

- **Entra:** `EnergyProfile`, candidatas compatibles, `TripConfiguration`, la función `simulateSoc` inyectada, `curve` y `PlannerConfig`.
- **Sale:** `ChargingPlanResult` (plan v2 §5.8), con `requiredInitialSocPercent`.
- **No hace:** proyectar estaciones, calcular energía ni tiempos de manejo.

**Algoritmo** (reemplaza la selección por puntaje de `planner.ts:142-559`):

1. **Nodos:** origen, candidatas compatibles ordenadas por distancia a lo largo de la ruta, destino.
2. **Tabla de tramos:** para cada par alcanzable (i → j), simular una sola vez sobre una malla gruesa de SOC de salida (cada 5 %) y guardar, para cada SOC de salida, el SOC de llegada y el mínimo del tramo, incluidos el desvío de ida en i y de vuelta a la vía en j. Interpolar entre puntos de la malla.
3. **Programación dinámica** sobre `(nodo, SOC de salida)` con malla de 1 %. Una transición es válida si el mínimo del tramo ≥ piso (con margen) y, si j es el destino, la llegada ≥ reserva.
4. **Costo lexicográfico según `planningMode`** (sin pesos arbitrarios):

   | `planningMode` | Orden de criterios |
   |---|---|
   | `fastest` | tiempo total (manejo + desvío + carga + espera) → paradas → km de desvío → margen mínimo (mayor) |
   | `fewer_stops` | paradas → tiempo total → km de desvío → margen mínimo |
   | `efficient` | energía neta total (con desvíos) → paradas → tiempo total |
   | `safer` | margen mínimo (mayor) → paradas → tiempo total |
   | `custom` | suma ponderada en minutos equivalentes con pesos en `PlannerConfig`, documentados en el plan |

5. **Espera por estado:** `offline` se excluye; `occupied` suma `occupiedWaitMin` (configurable, `estimated`) al tiempo. El precio y la fuente de datos no entran al costo en v1 (hoy suman puntos en `scoreCharger`); el precio se muestra.
6. **Validación final:** simulación completa del plan elegido con `simulateSoc` (incluido el recorte de regeneración por SOC). Si viola algo, se sube el SOC de salida del tramo afectado y se repite.
7. **Carga previa:** búsqueda binaria del SOC inicial mínimo (en puntos enteros, hacia arriba) para el que existe plan. Es una propiedad monótona, así que se reutiliza la tabla de tramos: no hay que re-anotar la ruta por cada SOC (hoy sí, `planner.ts:654-663`). Corrige C5 porque trabaja sobre el SOC real, no sobre `floor(100 − actual)`.
8. **Sin tope fijo de 7 paradas:** la programación dinámica termina sola. Se deja un tope de seguridad en `PlannerConfig`.

**Rendimiento objetivo:** < 150 ms por ruta en un teléfono de gama media, medido con el snapshot de Piedecuesta → Vélez, porque el store lo ejecuta en el navegador.

### 4.10 Viabilidad — `engines/feasibility/engine.ts`

**Pregunta:** ¿es posible el viaje en estas condiciones?

- Clasifica con los estados del plan v2 (`FEASIBLE_NO_CHARGING`, `FEASIBLE_ONE_STOP`, `FEASIBLE_MULTIPLE_STOPS`, `INFEASIBLE_WITH_CURRENT_SOC`, `INFEASIBLE_EVEN_AT_FULL_SOC`) y códigos de motivo.
- Reemplaza el texto libre de `NO_VERIFIED_STOP_REASON` y `FIRST_CHARGER_UNREACHABLE_REASON` (`domain/types.ts:334-339`). Los textos en español pasan a un mapa `código → mensaje` en la capa de presentación.
- `allowBelowSafety` deja de producir `feasible: true` sin cargador: produce `FEASIBLE_*` solo si el plan respeta el piso de 2 %; si no, es no viable con su motivo.

### 4.11 Series para gráficas — `engines/chart/series.ts`

- Consumo en ventanas de 1–5 km según el largo de la ruta, prorrateando los segmentos que cruzan el borde (plan v2 §5.10).
- SOC vs. distancia con los saltos de carga y los desvíos.
- Los bloques de 100 km (`consumptionBlocks`, `energy.ts:498`) se mudan aquí como otra agregación.
- `consumption-chart.tsx` deja de calcular (`seriesFrom`) y solo dibuja. Puede conservar el "promedio acumulado" como serie adicional si se quiere.

### 4.12 Composición — `compute-plan.ts` y `application/plan-trip/service.ts`

```ts
// Puro. Lo llaman el servidor y lib/store.ts.
export function computePlan(
  snapshot: PlanningSnapshot,
  vehicle: Vehicle,
  conditions: TripConditions,
  params: ModelParameters,
  options?: { fixedStops?: FixedStop[] },     // usado por verifyPlan
): { plans: EVRoutePlan[]; selectedId: string };

// Con I/O. Lo llama server/actions/plan.ts.
export class EVRoutePlanningService {
  constructor(private deps: {
    routing: RoutingProvider; elevation: ElevationProvider;
    weather: WeatherProvider | null; stations: StationCatalog;
    params: ModelParameters; clock: () => Date;
  }) {}
  async plan(request: PlanRequest): Promise<{ snapshot: PlanningSnapshot; plans: EVRoutePlan[]; selectedId: string }>;
  async verify(snapshot: PlanningSnapshot, planId: string, request: PlanRequest): Promise<EVRoutePlan>;
}
```

`application/container.ts` es el único lugar que conoce a Mapbox, Open-Meteo y Postgres:

```ts
export function createPlanningService(env = readEnv()): EVRoutePlanningService {
  const routing = env.mapboxToken ? new MapboxRoutingProvider(env.mapboxToken) : new OsrmRoutingProvider();
  const elevation = withFallback(new MapboxTerrainElevationProvider(env.mapboxToken), new OpenMeteoElevationProvider(), new OpenTopoDataElevationProvider());
  return new EVRoutePlanningService({ routing, elevation, weather: new OpenMeteoWeatherProvider(),
    stations: new DatasetStationCatalog(), params: MODEL_PARAMETERS, clock: () => new Date() });
}
```

La acción `planTripFn` queda en: rate limit → validar con Zod → `createPlanningService().plan(data)` → respuesta. La geocodificación (`searchPlacesFn`, `reversePlaceFn`) sigue igual, fuera del motor.

### 4.13 Responsabilidades

| Componente | Pregunta | No hace | I/O |
|---|---|---|---|
| route-selection (aplicación) | ¿Qué rutas candidatas hay? | Energía, carga | Sí, vía puerto |
| route/normalize | ¿Cuál es la ruta sobre un eje único? | Elegir rutas | No |
| elevation | ¿Cómo cambia la altitud? | Energía, velocidad | No |
| speed | ¿A qué velocidad y aceleración? | Energía | No |
| energy | ¿Cuánta energía por segmento? | SOC, paradas | No |
| soc | ¿Cómo evoluciona la batería? | Decidir paradas | No |
| corridor | ¿Dónde queda cada estación? | Compatibilidad, selección | No |
| compatibility | ¿Puedo cargar aquí y con qué? | Elegir estación | No |
| charging/curve | ¿Cuánto tarda la carga? | Elegir estación | No |
| charging/planner | ¿Dónde paro y cuánto cargo? | Energía, proyección | No |
| feasibility | ¿Es posible el viaje? | Energía, estaciones | No |
| chart | ¿Qué se grafica? | Física | No |
| compute-plan | Compone la pasada 1 | Lógica propia | No |
| EVRoutePlanningService | Reúne datos y verifica | Lógica de dominio | Sí, vía puertos |

---

## 5. Datos

### 5.1 Vehículos

- Migración del seed: pasar las fuentes de los comentarios SQL a `provenance` en el payload. `seeds.test.ts` ya compara el respaldo con el seed; se amplía para exigir `provenance` en cada campo requerido.
- `physics` queda vacío hasta tener cifras con fuente. La UI muestra "estimado" en el consumo cuando se usan valores por defecto (`assumptions` no vacío).
- Añadir `docs/catalogo-pendientes.md` → sección "coeficientes físicos pendientes por modelo".

### 5.2 Estaciones

- `StationConnector` gana `powerOrigin: "reported" | "assumed"` (C7), igual que `currentOrigin`. `mergeConnectors` lo llena.
- `currentFromStandard("gb_t")` deja de asumir DC cuando la fuente reporta la corriente; si no hay dato, queda `null` y la compatibilidad no propone adaptador DC.
- `toPlanningCharger` conserva `current` y `powerOrigin`.
- Sin cambios en fuentes, deduplicación, consolidación ni almacenamiento.

### 5.3 Viajes guardados y compartidos

- Se guarda el `PlanningSnapshot` (o su id, con el snapshot en una tabla aparte) junto al `PlanRequest`.
- Un viaje compartido se muestra con su snapshot. "Actualizar" vuelve a reunir datos explícitamente.
- `TripSummarySchema` gana `modelVersion` para saber con qué modelo se calculó.

---

## 6. Migración por fases

Cada fase es uno o pocos PR, deja la app funcionando y tiene criterio de cierre. El motor nuevo convive con el actual detrás de `PLANNER_ENGINE = legacy | shadow | v2`:

- `legacy`: como hoy.
- `shadow`: el servidor ejecuta ambos, responde con el actual y registra diferencias (km, energía, paradas, SOC de llegada, SOC mínimo) en el log `[plan-trip]` que ya existe.
- `v2`: responde con el nuevo.

| Fase | Contenido | Criterio de cierre |
|---|---|---|
| **F0 · Red de seguridad y correcciones** | Tests de regresión de C1, C2, C3, C5 y C8 (apéndice del feedback) y sus arreglos sobre el código actual. Script `scripts/record-snapshot.mjs` (a partir de `diagnose-route.mjs`) que graba el snapshot de Piedecuesta → Vélez como fixture. Reglas de ESLint de la sección 2.2 para `src/domain`. | Los 5 tests pasan; CI verde; fixture en el repo. |
| **F1 · Contratos y puertos** | `domain/ev/contracts`, `core` (unidades, `SourcedValue`, `ModelParameters`, eje, `trip-config`), `domain/ports`. Adaptadores que envuelven el código actual sin cambiar su comportamiento: `MapboxRoutingProvider`, `OsrmRoutingProvider`, `OpenMeteoElevationProvider`, `OpenMeteoWeatherProvider`, `DatasetStationCatalog`. `container.ts` y `EVRoutePlanningService` que por dentro llaman a `buildPlan`. La acción usa el servicio. | Misma respuesta que antes para el fixture (test de igualdad). La acción no importa proveedores. |
| **F2 · Snapshot y datos crudos** | Los proveedores devuelven `ProviderRoute` y elevaciones crudas. `route/normalize` y `elevation` en el dominio. Esquema de Mapbox separado del de OSRM (A3). `PlanningSnapshot` reemplaza a `GeoBundle` (con adaptador para el store persistido). | Contratos de adaptadores probados con respuestas grabadas; elevación con malla por distancia y limpieza; error tipado sin elevación. |
| **F3 · SOC separado** | `soc/simulate.ts`. `annotateEnergy` deja de calcular SOC y el recorte de regeneración pasa al SOCEngine. Desvíos y cargas como eventos. | Tests de §8.3 del plan v2 sobre SOC; C6 resuelto (energía de un tramo no depende del SOC). |
| **F4 · Corredor, compatibilidad y curva** | Un solo corredor; desvíos por matriz; compatibilidad con `vehicle.adapters`, corriente y potencia con origen; curva corregida. Casillas de adaptadores en el editor. | C4 y C7 resueltos; `stations/spatial.ts` y `attachChargersToRoute` eliminados. |
| **F5 · Energía v2 y velocidad** | `vehicle-params.ts` con `SourcedValue`; `PhysicsEnergyModel` y `ManualConsumptionModel`; perfil de velocidad con aceleración y curvatura; anotaciones extra de Mapbox. Modo `shadow` en producción. | Tests analíticos (llano, pendiente = m·g·Δh, ciclo 0 → v → 0). Diferencias de `shadow` revisadas y explicadas en un ADR. |
| **F6 · Sin multiplicadores** | Se borran `STYLE_MULT`, `STYLE_SPEED_FACTOR`, `CYCLE_OVERHEAD`, `LegacyCycleFactor` y la dependencia de `motorKw`. | `grep` sin esos símbolos; diferencias en `shadow` dentro del rango acordado. |
| **F7 · Planificador y viabilidad** | Programación dinámica lexicográfica por `planningMode`, carga previa sobre la tabla de tramos, `feasibility` con códigos, mensajes en presentación. | Cinco estados de viabilidad con perfiles sintéticos; ejemplo A/B/C del plan v2; < 150 ms por ruta con el fixture. |
| **F8 · Composición, gráficas y pasada 2** | `computePlan` en servidor y store; `verifyPlan`; `chart/series`; `legacy-adapter` para la UI; `PLANNER_ENGINE=v2`. | Caso Piedecuesta → Vélez de extremo a extremo (sección 7); UI sin cambios visibles salvo las correcciones. |
| **F9 · Limpieza** | La UI lee `EVRoutePlan`; se borran `planner.ts`, `annotateEnergy`, `legacy-adapter.ts` y el flag. `docs/calculo-consumo-energia.md` se reescribe con el modelo nuevo. Contrato de calibración (`TripObservation`) definido. | Cobertura ≥ umbrales actuales sobre `src/domain/ev`; documentación al día. |

**Orden alternativo** si se quiere ver valor antes: F0 → F3 → F4 → F7 dan la mayor parte de la mejora de correctitud sin tocar la física; F5–F6 cambian números de consumo y conviene hacerlas con `shadow`.

---

## 7. Caso de prueba: Piedecuesta → Vélez

### 7.1 Escenario

| Campo | Valor | Fuente |
|---|---|---|
| Ruta | Piedecuesta → Vélez, perfil `driving` de Mapbox (~212 km, casi toda por vías principales, según `routing.mapbox.ts:7-11`) | `external_source` (snapshot grabado en F0) |
| Coordenadas | Las que devuelva la geocodificación de la app, guardadas en el snapshot | `external_source` |
| Vehículo | MG S5 EV Deluxe 2027 (`mg-s5-ev-deluxe` del seed) | — |
| Peso en vacío | 1672 kg | `external_source` (elcarrocolombiano.com; ficha MG Colombia 1.627–1.672 kg) |
| Batería útil | 47,1 kWh (`batteryKwh`) | `external_source` (elcarrocolombiano.com: 47,1 neta) |
| Batería bruta | 49 kWh | `manufacturer` (mgcolombia.com) |
| Carga AC / DC | 7 kW / 120 kW | `external_source` |
| Conectores | CCS2 y Tipo 2 | `manufacturer` |
| Potencia del motor | 125 kW (informativa; no entra al consumo) | `manufacturer` |
| Ocupantes | 150 kg = conductor 75 + `passengers: 1` × 75 | `configurable` |
| Equipaje | 30 kg | `configurable` |
| Masa total | 1852 kg | `calculated` |
| Conducción / regeneración | `normal` / `medium` | `configurable` |
| Aire acondicionado | `ac: "normal"` | `configurable` |
| Reserva | `safetyMode: "low"` (10 %) y `arrivalSoc: 10` | `configurable` |
| SOC inicial | [COMPLETAR — propuesto 80 %] | `configurable` |
| Temperatura | Clima del snapshot, o fija [propuesto 25 °C] para el test determinístico | `configurable` |
| Estaciones | Dataset del snapshot (`stationsVersion` fijo) | `external_source` |
| Adaptadores del usuario | [COMPLETAR — p. ej. ninguno, o GB/T → CCS2] | `configurable` |

### 7.2 Parámetros físicos (tabla obligatoria en el informe)

| Parámetro | Hoy | Fuente | Acción |
|---|---|---|---|
| Cd, área frontal | Cd·A inferido de peso y potencia (`energy.ts:117`) | `estimated` | [COMPLETAR con ficha o prueba independiente; si no, tabla por `bodyType: "suv"`] |
| Crr | Inferido del peso (`energy.ts:125`) | `estimated` | [COMPLETAR o valor por defecto documentado] |
| Eficiencia de tracción | Inferida de la potencia (`energy.ts:129`) | `estimated` | Constante por defecto documentada |
| Eficiencia y tope de regeneración | 0,55 del excedente; 40 % de `motorKw` | `estimated` | Parámetros separados, por defecto documentados |
| Batería útil | 47,1 kWh | `external_source` | Sin cambios |
| Auxiliares | 0,45 kW + clima 1,2 kW (± temperatura) | `estimated` | Sin cambios; a calibrar |
| Curva de carga | `DEFAULT_CURVE` genérica | `estimated` (el seed dice "no verificable") | Buscar curva medida; si no, se mantiene marcada |

### 7.3 Pruebas

- **Extremo a extremo** sobre el snapshot (sin red): plan completo, determinismo (dos ejecuciones deep-equal) e invariantes del plan v2 §8.4.
- **Variantes:**
  - SOC inicial 20 % → pide carga previa o paradas, con el mensaje correcto;
  - sin estaciones compatibles → estado de no viabilidad con motivo;
  - los tres modos de conducción → orden de consumo esperado (aviso, no fallo).
- **Sombra:** diferencias entre motor actual y nuevo para este caso, explicadas en el ADR de F5.

---

## 8. Riesgos y decisiones abiertas

| Riesgo o decisión | Mitigación o propuesta |
|---|---|
| Cambian los números que ve el usuario (consumo, paradas) | Modo `shadow`, ADR con las diferencias, nota en la UI la primera vez |
| Presupuesto de consultas de elevación con malla fina | Teselas de terreno con caché persistente; malla adaptativa; tope de consultas |
| Cobertura de límites de velocidad de Mapbox en Colombia desconocida | Medir en F5 con el snapshot (`dataQuality.speedLimitCoveragePercent`); tabla por clase vial con fuente normativa |
| Coeficientes físicos no disponibles para la mayoría del catálogo | Valores por defecto marcados `estimated`, visibles en la UI; calibración con viajes reales |
| Rendimiento en el navegador | Tabla de tramos + programación dinámica; objetivo < 150 ms por ruta; si no se cumple, recalcular en el servidor |
| Snapshots pesados en viajes guardados | Guardar geometría con polyline6 y comprimir; tabla aparte con id |
| ¿`minSocRecommended` entra al piso? | Decidir en F0 (C8). Propuesta: sí, porque es lo que el panel de batería ya muestra |
| ¿`driving-traffic` vuelve algún día? | Solo con el control de atajos por jerarquía, que ya existe; decisión fuera de este plan |
