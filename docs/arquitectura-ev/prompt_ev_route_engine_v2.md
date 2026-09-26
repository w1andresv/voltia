# EV Route Planning Engine — Especificación de implementación v2

## 0. Instrucciones para quien implementa

Antes de escribir código:

1. Inspecciona el repositorio: lenguaje, framework, estructura de carpetas, test runner y convenciones existentes. Adáptate a ellas.
2. Localiza el **listado consolidado de electrolineras** que ya existe: dónde vive, su modelo de datos y qué campos trae (coordenadas, conectores, potencia, estado).
3. Entrega un plan breve: ubicación de cada módulo, cómo se mapea el modelo de estaciones existente al tipo `ChargingStation` de este dominio y qué campos faltan en el listado.

Durante la implementación:

- Implementa por fases (sección 10). No avances de fase sin que pasen los tests de la anterior.
- Si falta un dato necesario (p. ej., un parámetro del vehículo), **no lo inventes**: márcalo como `estimated` con justificación, o detente y pregunta.
- Cualquier funcionalidad fuera de esta especificación requiere documentar primero la razón y el impacto arquitectónico en un ADR corto (`docs/adr/`).

---

## 1. Objetivo y alcance

Dado un vehículo, un origen y destino (coordenadas), un SOC inicial, el peso de ocupantes y equipaje, un modo de conducción, un modo de regeneración, las condiciones ambientales y el listado existente de electrolineras, el sistema debe calcular **de forma determinística**:

- el consumo energético por segmento;
- la evolución del SOC;
- la viabilidad de la ruta;
- las paradas de carga necesarias, con compatibilidad de conectores, adaptadores, energía a cargar y tiempo de carga.

**Fuera de alcance en v1** (dejar puntos de extensión, no implementar):

- descubrimiento o consulta de electrolineras (se usa exclusivamente el listado existente);
- geocodificación (la entrada son coordenadas);
- disponibilidad en tiempo real de cargadores, precios y reservas;
- viento, efecto de la temperatura sobre la batería, degradación (SOH);
- modelo de tráfico stop-and-go;
- la calibración en sí (sí se define su contrato de datos, sección 9).

---

## 2. Principios de arquitectura (obligatorios)

1. **Una pregunta por engine.** Ver la tabla de responsabilidades (sección 11).
2. **Solo los Providers hacen I/O** (red, disco, caché). Los engines de cálculo —SpeedProfile, Energy, SOC, StationCorridor, StationCompatibility, ChargingPlanner, RouteFeasibility y la agregación para gráficas— son **funciones puras**: sin red, sin reloj, sin aleatoriedad, sin estado global.
3. **Los engines no se llaman entre sí.** Los compone un orquestador (`EVRoutePlanningService`). Única excepción documentada: el `ChargingPlanner` recibe inyectada la función de simulación del `SOCEngine` para evaluar tramos, precisamente para no duplicar cálculos.
4. **Inyección de dependencias** por constructor. Toda dependencia externa va detrás de una interfaz (`RoutingProvider`, `ElevationProvider`, `StationSource`).
5. **Una sola fuente de verdad.** El consumo se calcula una única vez en el `EnergyEngine`. SOC, planificación, viabilidad y visualización se derivan de él. No existen cálculos de consumo paralelos (ni en el planner ni en el frontend).
6. **Unidades.** Cálculo interno en SI (m, s, m/s, m/s², kg, N, J, W). Todo campo numérico expuesto lleva la unidad en el nombre (`distanceKm`, `speedKmh`, `energyKWh`, `powerKw`). Las conversiones viven en un único módulo de utilidades con tests.
7. **Sin redondeo interno.** Se redondea solo en la capa de presentación. Prohibido `Math.round`, `toFixed` o equivalentes dentro del dominio. Los valores de "carga necesaria" se redondean **hacia arriba** al presentarse (redondear hacia abajo un requisito es inseguro).
8. **Determinismo.** Mismas entradas + mismas respuestas de proveedores ⇒ salida idéntica (deep-equal). Las respuestas de los proveedores se guardan como *snapshot* con id/hash, y el plan referencia los snapshots usados. Mapbox con tráfico no es determinístico por sí mismo: el determinismo se garantiza sobre el snapshot.
9. **Trazabilidad de datos.** Todo parámetro del vehículo o del modelo es un `SourcedValue` (sección 3.1).
10. **Parámetros centralizados y versionados** en `ModelParameters` (con `modelVersion`), para poder calibrar después sin tocar código.
11. **Errores vs. no viabilidad.** Un fallo de proveedor o datos insuficientes produce un error tipado; nunca se reporta como "ruta no viable". Un dato opcional ausente (p. ej., límite de velocidad) usa un fallback documentado y genera un warning en el plan.

---

## 3. Tipos compartidos

### 3.1 Procedencia de datos

```ts
type DataSource =
  | 'manufacturer'      // ficha técnica u homologación del fabricante
  | 'external_source'   // base de datos, prueba independiente, publicación
  | 'calculated'        // derivado con una fórmula documentada
  | 'estimated'         // sin fuente directa; debe calibrarse
  | 'configurable';     // elección del usuario o del sistema

interface SourcedValue<T> {
  value: T;
  source: DataSource;
  reference?: string;   // URL, documento, fórmula o justificación
  notes?: string;
}
```

Nunca presentar un valor `estimated` como dato oficial. El plan final debe listar todos los supuestos usados (`assumptions`).

### 3.2 Geometría y eje de distancia

```ts
interface Coordinate {
  latitude: number;
  longitude: number;
}
```

- **Eje de distancia canónico:** distancia geodésica acumulada (elegir haversine o Vincenty y documentarlo) calculada sobre `route.geometry`. Todos los `distanceKm` del sistema se refieren a este eje.
- La distancia del proveedor (`providerDistanceKm`) se conserva solo como referencia; la diferencia se reporta en `dataQuality`.
- Utilidades puras compartidas: `resampleAlongRoute(route, stepM)` e `interpolateAtDistance(series, distanceKm)`. Todas las mallas se generan con ellas.

**Mallas:**

- **Malla fina** (default 50 m, configurable): elevación y perfil de velocidad.
- **Segmentos de energía** (default 200 m, configurable entre 100 y 500 m): construidos a partir de la malla fina. Los límites de segmento deben coincidir con los límites de *leg* (waypoints de carga).

### 3.3 Vehículo (datos permanentes)

```ts
type ConnectorType =
  | 'CCS1' | 'CCS2' | 'CHADEMO' | 'GBT_DC' | 'GBT_AC'
  | 'TYPE1' | 'TYPE2' | 'NACS' | 'UNKNOWN';

type CurrentType = 'AC' | 'DC';

interface VehicleChargePort {
  connector: ConnectorType;
  current: CurrentType;
  maxPowerKw: SourcedValue<number>;  // DC: potencia máx. de carga; AC: cargador a bordo
}

interface ChargingCurvePoint {
  socPercent: number;
  maxChargingPowerKw: number;        // potencia en el lado de la batería
}

interface EVVehicle {
  id: string;
  brand: string;
  model: string;
  version: string;                   // año/versión: los parámetros dependen de ella

  curbWeightKg: SourcedValue<number>;

  batteryCapacityKWh: SourcedValue<number>;        // bruta
  usableBatteryCapacityKWh: SourcedValue<number>;  // referencia del SOC (0–100 %)

  dragCoefficient: SourcedValue<number>;
  frontalAreaM2: SourcedValue<number>;
  rollingResistanceCoefficient: SourcedValue<number>;
  rotationalInertiaFactor: SourcedValue<number>;   // masa equivalente para aceleración (típ. 1.03–1.08)

  drivetrainEfficiency: SourcedValue<number>;      // batería → rueda (tracción), 0–1
  regenEfficiency: SourcedValue<number>;           // rueda → batería (regeneración), 0–1
  maxRegenPowerKw: SourcedValue<number>;

  baseAuxiliaryPowerKw: SourcedValue<number>;      // electrónica, luces, bombas (sin climatización)
  airConditioningPowerKw: SourcedValue<number>;    // v1: constante; futuro: función de la temperatura

  chargePorts: VehicleChargePort[];
  chargingCurve?: SourcedValue<ChargingCurvePoint[]>;

  // Informativos. NO se usan en el cálculo de consumo.
  maxPowerKw?: SourcedValue<number>;
  maxTorqueNm?: SourcedValue<number>;
  maxRegenTorqueNm?: SourcedValue<number>;
}
```

### 3.4 Configuración del viaje

```ts
type DrivingMode = 'efficient' | 'normal' | 'sport';
type RegenerationMode = 'low' | 'medium' | 'high';

interface AmbientConditions {
  temperatureC: number;              // se usa para la densidad del aire
  // Extensión futura: viento, humedad, presión medida
}

interface ChargingAdapter {
  id: string;
  stationConnector: ConnectorType;   // lado estación (entrada del adaptador)
  vehicleInlet: ConnectorType;       // lado vehículo (salida del adaptador)
  current: CurrentType;
  maxPowerKw?: SourcedValue<number>;
  label: string;                     // p. ej. "GB/T (estación) → CCS2 (vehículo)"
}

interface TripConfiguration {
  initialSocPercent: number;
  passengersWeightKg: number;
  luggageWeightKg: number;

  drivingMode: DrivingMode;
  regenerationMode: RegenerationMode;
  airConditioning: boolean;
  ambient: AmbientConditions;
  departureTime?: string;                 // ISO 8601, relevante para el tráfico

  availableAdapters: ChargingAdapter[];   // los que lleva el usuario; no son del vehículo

  minimumArrivalSocPercent: number;       // piso en TODO punto de la ruta, no solo al llegar a una estación
  destinationReserveSocPercent: number;   // SOC mínimo al llegar al destino
  maxChargeTargetSocPercent: number;      // tope de carga por parada (p. ej. 80 %)
  planningEnergyMarginPercent: number;    // margen de seguridad sobre el consumo, solo para planificar
}
```

`minimumArrivalSocPercent` se aplica en todo punto porque el SOC mínimo puede ocurrir en una cima entre dos estaciones, no necesariamente al llegar a una. `planningEnergyMarginPercent` es un margen de seguridad explícito del planner; **no modifica el `EnergyProfile`** ni el modelo físico.

### 3.5 Estaciones (adaptador del listado existente)

```ts
interface StationConnector {
  type: ConnectorType;
  current: CurrentType;
  powerKw?: SourcedValue<number>;    // ausente si el listado no lo trae
  count?: number;
  status?: 'operational' | 'out_of_service' | 'unknown';
}

interface ChargingStation {
  id: string;                        // id del listado existente
  name?: string;
  location: Coordinate;
  connectors: StationConnector[];
}

interface StationSource {
  getStations(): Promise<ChargingStation[]>;
}
```

- Implementar `StationSource` como adaptador del listado existente. No modificar su origen ni su lógica de consolidación.
- Conectores no reconocidos → `UNKNOWN`, excluidos de compatibilidad, con warning.
- Política configurable para potencia desconocida: `exclude` o `assumeConservativeKw` (valor marcado `estimated`).
- Conectores `out_of_service` se excluyen; `unknown` se permite con warning.

### 3.6 Ruta

```ts
interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
  waypoints?: Coordinate[];          // se usa para rutear pasando por estaciones de carga
  departureTime?: string;
}

interface RouteSegment {
  startKm: number;
  endKm: number;
  roadClass?: string;
  speedLimitKmh?: number;
  typicalSpeedKmh?: number;          // velocidad del proveedor (con tráfico si aplica)
  congestion?: 'low' | 'moderate' | 'heavy' | 'severe' | 'unknown';
  isTunnel?: boolean;
  isBridge?: boolean;
  isToll?: boolean;
}

interface RouteLeg {
  startKm: number;
  endKm: number;
}

interface Route {
  id: string;
  provider: string;
  providerSnapshotId: string;
  geometry: Coordinate[];
  cumulativeDistanceKm: number[];    // eje canónico; mismo largo que geometry
  distanceKm: number;                // último valor del eje canónico
  providerDistanceKm: number;
  providerDurationMinutes: number;
  segments: RouteSegment[];
  legs: RouteLeg[];                  // un leg por tramo entre waypoints
}
```

---

## 4. Pipeline y orquestación

`EVRoutePlanningService.plan(input): Promise<EVRoutePlan>` compone los engines en dos pasadas. La segunda existe porque añadir paradas cambia la ruta (desvíos) y la energía debe recalcularse sobre la ruta real.

```text
PASADA 1 — planificación sobre la ruta base
  1. RouteEngine ................ ruta principal (+ alternativas si se piden)
  Para cada ruta candidata:
  2. ElevationEngine ............ perfil altimétrico
  3. SpeedProfileEngine ......... perfil de velocidad
  4. EnergyEngine ............... EnergyProfile
  5. SOCEngine .................. SOCProfile sin cargas
  6. StationCorridorEngine ...... estaciones del listado proyectadas sobre la ruta
  7. StationCompatibilityEngine . compatibilidad de cada candidata
  8. ChargingPlanner ............ paradas + SOC inicial mínimo requerido
  Selección de ruta: mismo criterio lexicográfico del planner (5.8.5)

PASADA 2 — verificación con desvíos reales (solo si hay paradas)
  9.  RouteEngine con las estaciones elegidas como waypoints
  10. Pasos 2–4 sobre la ruta real (velocidad 0 en cada waypoint de carga)
  11. SOCEngine con los eventos de carga del plan
  12. Si se viola alguna restricción → replanificar sobre la ruta real
      (máx. maxPlanningIterations, default 3). Si no converge:
      no viable con reasonCode = 'PLAN_VALIDATION_FAILED'.

CIERRE
  13. RouteFeasibilityEngine ..... clasificación final
  14. Ensamblar EVRoutePlan
```

Si se piden alternativas, el servicio devuelve el plan de la ruta elegida y un resumen comparativo de las demás.

---

## 5. Engines

### 5.1 RouteEngine

**Pregunta:** ¿Por qué carretera debo ir?

```ts
interface RoutingProvider {
  calculateRoute(request: RouteRequest): Promise<Route>;
  calculateAlternativeRoutes(request: RouteRequest): Promise<Route[]>;
}
```

Implementación inicial: `MapboxRoutingProvider`. El resto del sistema depende de `RoutingProvider`, nunca de Mapbox.

Notas para Mapbox (verificar contra la documentación vigente):

- Usar el perfil con tráfico cuando la salida sea inmediata o cercana y el perfil estándar en otro caso; revisar el límite de waypoints de cada perfil.
- Pedir geometría completa y las anotaciones por tramo disponibles (distancia, duración, velocidad, velocidad máxima, congestión). Tomar la clase de vía, túneles y peajes de los datos de intersecciones cuando existan.
- El token vive solo en el servidor.
- Guardar la respuesta cruda como snapshot (id/hash) para reproducibilidad y tests.
- Convertir a `Route` calculando el eje canónico.

**No hace:** consumo, SOC, selección de estaciones, tiempos de carga, decisión de carga, compatibilidad de conectores.

### 5.2 ElevationEngine

**Pregunta:** ¿Cómo cambia la altitud a lo largo de la ruta?

El proveedor solo devuelve elevaciones crudas; la distancia y la pendiente las calcula el engine.

```ts
interface RawElevationSample {
  coordinate: Coordinate;
  elevationM: number;
}

interface ElevationProvider {
  getElevations(coordinates: Coordinate[]): Promise<RawElevationSample[]>;
}
```

Implementaciones intercambiables: `CopernicusElevationProvider`, `MapboxElevationProvider` (decodificando teselas de terreno). Con caché y snapshot.

**Flujo:**

1. Remuestrear la geometría en la malla fina.
2. Consultar el proveedor.
3. **Limpieza** (obligatoria; el DEM crudo infla artificialmente la energía de pendiente):
   - túneles y puentes marcados por la ruta → interpolar linealmente la elevación entre sus extremos (el DEM devuelve el fondo del valle o la cima de la montaña);
   - suavizado configurable (media móvil o Savitzky–Golay, ventana de 100 a 300 m);
   - límite de pendiente configurable (p. ej. ±20 %); los valores recortados se reportan en `dataQuality`.
4. Calcular la pendiente sobre la elevación limpia y la distancia horizontal.

Documentar que Copernicus GLO-30 es un modelo digital de **superficie** (incluye vegetación y edificaciones), no de terreno desnudo.

```ts
interface ElevationPoint {
  distanceKm: number;
  latitude: number;
  longitude: number;
  rawElevationM: number;
  elevationM: number;        // tras limpieza
  gradePercent: number;      // pendiente del tramo [i, i+1]; el último punto repite la del tramo anterior
}

interface ElevationProfile {
  points: ElevationPoint[];
  provider: string;
  snapshotId: string;
  totalAscentM: number;
  totalDescentM: number;
}
```

**No hace:** consumo, SOC, estaciones, velocidades.

### 5.3 SpeedProfileEngine

**Pregunta:** ¿A qué velocidad y con qué aceleraciones esperamos que se desplace el vehículo?

El modo de conducción modifica **velocidad y aceleración**; el efecto sobre el consumo lo calcula el `EnergyEngine`. Prohibido `sport = consumo × 1.20` o cualquier multiplicador de consumo.

**Algoritmo (determinístico):**

1. **Velocidad esperada** por punto: `v_exp = min(speedLimit ?? defaultByRoadClass, typicalSpeed ?? ∞)`. La tabla `defaultSpeedByRoadClass` es configurable y debe citar su fuente (normativa local o `configurable`).
2. **Límite por curvatura:** `v_curve = sqrt(a_lat_max × R)`, con R = radio del círculo por tres puntos de la geometría suavizada. Es decisivo en carreteras de montaña.
3. **Velocidad objetivo por modo:**
   - `efficient`: `targetSpeedFactor × v_exp`;
   - `normal`: `v_exp`;
   - `sport`: el límite legal cuando la congestión no es `heavy`/`severe`; si lo es, `v_exp`.
   - Siempre: `v_target = min(valor anterior, speedLimit, v_curve)`. Nunca se supera el límite legal.
4. **Pasada hacia adelante** con `maxAccelMs2` (`v²ᵢ₊₁ ≤ v²ᵢ + 2·a·Δs`) y **pasada hacia atrás** con `maxDecelMs2`. Velocidad 0 en origen, destino y waypoints de carga.
5. **Aceleración por tramo** derivada del perfil: `a = (v_fin² − v_ini²) / (2·Δs)`.
6. Sin aleatoriedad. La "mayor variabilidad" del modo sport se representa con límites más altos de aceleración, frenado y aceleración lateral.
7. Reportar la duración resultante frente a `providerDurationMinutes` (desviación en %, en `dataQuality`). No reescalar en silencio.

**Parámetros por modo** (valores iniciales `estimated`, sujetos a calibración):

| Parámetro | efficient | normal | sport |
|---|---|---|---|
| `targetSpeedFactor` | 0.90 | 1.00 | límite legal |
| `maxAccelMs2` | 0.8 | 1.2 | 2.0 |
| `maxDecelMs2` | 0.8 | 1.5 | 2.5 |
| `maxLateralAccelMs2` | 1.5 | 2.0 | 3.0 |

```ts
interface SpeedProfilePoint {
  distanceKm: number;
  speedKmh: number;
  accelerationMs2: number;   // del tramo [i, i+1]
  targetSpeedKmh: number;
  limitingFactor:
    | 'speed_limit' | 'road_class_default' | 'traffic'
    | 'curvature' | 'acceleration' | 'deceleration' | 'stop';
}

interface SpeedProfile {
  points: SpeedProfilePoint[];
  drivingMode: DrivingMode;
  estimatedDurationMinutes: number;
}
```

**No hace:** energía, SOC, estaciones.

### 5.4 EnergyEngine

**Pregunta:** ¿Cuánta energía consume o recupera el vehículo en cada segmento?

**Entradas:** `EVVehicle`, `TripConfiguration`, `Route`, `ElevationProfile`, `SpeedProfile`, `ModelParameters`.

**Construcción de segmentos:** segmentos de `energySegmentLengthM` sobre el eje canónico. Para cada uno se interpolan desde la malla fina la velocidad y la elevación en sus extremos (`v1`, `v2`, `h1`, `h2`).

**Modelo físico por segmento (SI):**

```text
d_h    = longitud horizontal del segmento (m)
Δh     = h2 − h1
θ      = atan(Δh / d_h)
d      = d_h / cos θ                         (longitud sobre la pendiente)

m      = curbWeight + passengersWeight + luggageWeight
m_eff  = m × rotationalInertiaFactor         (solo para la fuerza de aceleración)

p      = 101325 × (1 − 2.25577e-5 × h_media)^5.25588      [Pa]
ρ      = p / (287.05 × (temperatureC + 273.15))           [kg/m³]

v̄²     = (v1² + v2²) / 2      (exacto con aceleración constante: v² es lineal en la distancia)
t      = 2d / (v1 + v2)       (v1 + v2 = 0 con d > 0 es un error de entrada)
a      = (v2² − v1²) / (2d)

F_aero = 0.5 × ρ × Cd × A × v̄²
F_roll = Crr × m × g × cos θ          (g = 9.80665 m/s²)
F_grade= m × g × sin θ
F_acc  = m_eff × a
F_total= F_aero + F_roll + F_grade + F_acc

E_wheel = F_total × d                 [J]
P_wheel = E_wheel / t                 (media, informativa)
```

Invariante: la contribución de la pendiente suma exactamente `m·g·Δh` por segmento, sin importar el tamaño del segmento.

**De la rueda a la batería:**

```text
Tracción (E_wheel > 0):
  E_traction = E_wheel / drivetrainEfficiency

Frenado (E_wheel < 0):
  E_capturable = |E_wheel| × captureFraction(mode) × regenEfficiency
  E_regen      = min(E_capturable, maxRegenPowerKw × maxPowerFraction(mode) × t)
  E_friction   = |E_wheel| − E_regen / regenEfficiency       (disipado en frenos)

Auxiliares (SIEMPRE, también en frenado y en bajadas):
  P_aux = baseAuxiliaryPowerKw + (airConditioning ? airConditioningPowerKw : 0)
  E_aux = P_aux × t

energyConsumedKWh    = E_traction + E_aux
energyRegeneratedKWh = E_regen     (potencial; el recorte por SOC alto lo aplica el SOCEngine)
netEnergyKWh         = energyConsumedKWh − energyRegeneratedKWh
```

**Modos de regeneración:** `captureFraction` y `maxPowerFraction` por modo son parámetros configurables marcados `estimated`. Nunca asumir recuperación del 100 %. Nota para calibración: en muchos vehículos el frenado combinado hace que la energía recuperada en bajadas dependa poco del modo; el modo afecta sobre todo la deceleración al soltar el acelerador.

**Potencia y torque máximos** no se usan como multiplicadores de consumo.

**Puntos de extensión** (interfaces, implementación constante en v1): `EfficiencyModel` (futuro: mapa por velocidad y par), `AirConditioningModel` (futuro: función de la temperatura), `WindModel`.

```ts
interface EnergySegment {
  startKm: number;
  endKm: number;
  distanceKm: number;
  durationS: number;

  elevationStartM: number;
  elevationEndM: number;
  gradePercent: number;

  speedStartKmh: number;
  speedEndKmh: number;
  speedKmh: number;              // media temporal = d / t
  accelerationMs2: number;
  airDensityKgM3: number;

  rollingForceN: number;
  aerodynamicForceN: number;     // media sobre la distancia
  gradeForceN: number;
  accelerationForceN: number;
  totalWheelForceN: number;

  wheelEnergyKWh: number;
  wheelPowerKw: number;          // media

  tractionEnergyKWh: number;
  auxiliaryEnergyKWh: number;
  energyConsumedKWh: number;
  energyRegeneratedKWh: number;
  frictionBrakeEnergyKWh: number;
  netEnergyKWh: number;
}

interface EnergyProfile {
  segments: EnergySegment[];
  totalMassKg: number;
  totals: {
    energyConsumedKWh: number;
    energyRegeneratedKWh: number;
    netEnergyKWh: number;
    auxiliaryEnergyKWh: number;
    frictionBrakeEnergyKWh: number;
  };
  modelVersion: string;
}
```

**No hace:** SOC, selección de estaciones, decisión de carga.

### 5.5 SOCEngine

**Pregunta:** ¿Cómo evoluciona la batería durante la ruta?

No calcula consumo: simula el estado de la batería a partir del `EnergyProfile`.

```ts
interface SOCSimulationOptions {
  chargingEvents?: { distanceKm: number; energyAddedKWh: number }[];
  regenSocCeilingPercent: number;       // default 100; configurable
  consumptionMarginFraction: number;    // default 0; lo usa el planner para su margen de seguridad
  minimumSocPercent: number;            // para detectar violaciones y déficit
}

function simulateSoc(
  profile: EnergyProfile,
  usableCapacityKWh: number,
  initialSocPercent: number,
  options: SOCSimulationOptions
): SOCProfile;
```

**Reglas:**

- Por segmento: `E = E_prev − consumed × (1 + margin) + regen`, recortando para no superar `regenSocCeilingPercent`. Lo que no cabe se reporta como `regenCurtailedKWh`. Esto resuelve el caso de bajar con la batería llena: el `EnergyEngine` no conoce el SOC y no puede aplicar ese límite.
- **No recortar por debajo de 0.** Un SOC negativo indica déficit y es necesario para calcular cuánta carga falta; se marca como violación.
- Eventos de carga: se insertan dos puntos en la misma distancia (llegada y salida).
- `SOC = energyAvailable / usableCapacity × 100`.

```ts
interface SOCPoint {
  distanceKm: number;
  energyAvailableKWh: number;
  socPercent: number;
  energyConsumedKWh: number;      // del segmento que termina en este punto
  energyRegeneratedKWh: number;   // aceptado por la batería
  regenCurtailedKWh: number;
  event?: 'start' | 'charge_arrival' | 'charge_departure' | 'destination';
}

interface SOCProfile {
  points: SOCPoint[];
  minimumSocPercent: number;
  minimumSocDistanceKm: number;
  destinationSocPercent: number;
  remainingEnergyKWh: number;
  totalRegenCurtailedKWh: number;
  violatesMinimumSoc: boolean;
  firstViolationDistanceKm?: number;
  maxDeficitKWh: number;          // energía que faltaría para no violar el piso (0 si no viola)
}
```

**No hace:** decidir dónde cargar.

### 5.6 StationCorridorEngine (nuevo)

**Pregunta:** ¿Dónde queda cada estación del listado respecto a la ruta?

**Por qué existe:** el planner necesita la distancia a lo largo de la ruta y el desvío de cada estación. Esto **no es descubrimiento**: filtra y proyecta el listado existente con geometría pura, sin APIs.

**Entrada:** `Route`, `ChargingStation[]`, configuración (`maxLateralDistanceKm`, `detourRoadFactor` marcado `estimated`).

```ts
interface RouteStationCandidate {
  station: ChargingStation;
  distanceAlongRouteKm: number;
  lateralDistanceKm: number;      // distancia geodésica al punto más cercano de la ruta
  estimatedDetourKm: number;      // ida y vuelta: 2 × lateral × detourRoadFactor (estimated)
}
```

Si la ruta pasa cerca de la misma estación más de una vez, usar la proyección de menor distancia lateral; en caso de empate, la primera a lo largo de la ruta.

**No hace:** compatibilidad, selección, consumo.

### 5.7 StationCompatibilityEngine

**Pregunta:** ¿Puede este vehículo cargar en esta estación y necesita adaptador?

**Reglas:**

- **Conexión directa:** el tipo de conector de la estación coincide con un puerto del vehículo y el tipo de corriente es el mismo.
- **Con adaptador:** existe en `availableAdapters` uno con `stationConnector` = conector de la estación, `vehicleInlet` = puerto del vehículo y la misma corriente.
- `availablePowerKw = min(potencia del conector, maxPowerKw del puerto, maxPowerKw del adaptador si existe)`.
- Se ignoran conectores `out_of_service`; la potencia desconocida sigue la política de 3.5.
- Opciones ordenadas por `availablePowerKw` descendente; en empate, primero la que no requiere adaptador.

**Ejemplo:** vehículo con puerto CCS2; estación con CCS1 (40 kW) y GB/T DC (50 kW). Si el usuario lleva un adaptador CCS1 (estación) → CCS2 (vehículo): `compatible = true`, `requiresAdapter = true`, `adapterType = "CCS1 (estación) → CCS2 (vehículo)"`. Sin adaptador compatible: `compatible = false`, `incompatibilityReason = 'NO_ADAPTER_AVAILABLE'`.

```ts
interface CompatibilityOption {
  stationConnectorType: ConnectorType;
  vehicleInletType: ConnectorType;
  currentType: CurrentType;
  requiresAdapter: boolean;
  adapterId?: string;
  adapterType?: string;
  availablePowerKw: number;
  powerSource: DataSource;                          // p. ej. estimated si la potencia era desconocida
  limitingFactor: 'station' | 'vehicle' | 'adapter';
}

interface CompatibilityResult {
  stationId: string;
  compatible: boolean;
  // Campos de la mejor opción, por conveniencia:
  requiresAdapter: boolean;
  adapterType?: string;
  connectorType?: ConnectorType;
  availablePowerKw?: number;
  // Detalle:
  options: CompatibilityOption[];
  incompatibilityReason?:
    | 'NO_MATCHING_CONNECTOR'
    | 'NO_ADAPTER_AVAILABLE'
    | 'ALL_CONNECTORS_OUT_OF_SERVICE'
    | 'UNKNOWN_POWER_EXCLUDED';
}
```

**No hace:** decidir qué estación utilizar.

### 5.8 ChargingPlanner

**Pregunta:** ¿Dónde debo parar y cuánto necesito cargar?

**Entradas:** `Route`, `EnergyProfile`, `SOCProfile` (sin cargas), `RouteStationCandidate[]`, `CompatibilityResult[]`, `EVVehicle`, `TripConfiguration`, la función `simulateSoc` inyectada y `PlannerConfig`.

**No hace:** buscar estaciones (usa solo las candidatas del listado existente) ni recalcular consumo.

Debe determinar: si la ruta es viable, qué estaciones son alcanzables, cuáles son compatibles, cuáles requieren adaptador, cuáles son necesarias, SOC de llegada, energía a cargar, SOC de salida y SOC en destino.

#### 5.8.1 Energía de los desvíos

En la pasada 1: `estimatedDetourKm × consumo neto medio local` (kWh/km del `EnergyProfile` en una ventana configurable alrededor del punto de proyección, p. ej. ±2 km). Es un valor derivado del perfil, no un cálculo físico paralelo; se marca `estimated` y se reemplaza por el valor real en la pasada 2.

#### 5.8.2 Evaluación de tramos

Para un tramo A → B saliendo con SOC `s`, usar `simulateSoc` sobre el intervalo del perfil (más la energía del desvío) con `consumptionMarginFraction = planningEnergyMarginPercent / 100`. El tramo es válido si:

- en ningún punto el SOC cae por debajo de `minimumArrivalSocPercent`;
- si B es el destino, el SOC de llegada es ≥ `destinationReserveSocPercent`.

No usar reglas del tipo `if SOC < 20 %`: la viabilidad se decide proyectando el consumo futuro.

**Ejemplo** (reserva 10 %, SOC actual 70 %):

```text
Estación A  → llegada 55 %
Estación B  → llegada 35 %
Estación C  → llegada 18 %
Destino     → llegada 4 % sin cargar  (< 10 % ⇒ hace falta al menos una parada)
```

Una sola parada en C basta si, cargando allí, se llega al destino con ≥ 10 %. A y B no son necesarias.

#### 5.8.3 Cuánto cargar

- El SOC de salida de cada parada es el mínimo necesario para completar el siguiente tramo con las restricciones, limitado por `maxChargeTargetSocPercent`.
- Si un tramo exige superar ese tope, se permite hasta 100 % solo si `allowChargeAboveTarget` está activo, y se emite un warning.
- La carga se modela como `energyAddedKWh = (SOC_salida − SOC_llegada) / 100 × usableCapacity` (lado batería).

#### 5.8.4 Tiempo de carga (curva de carga)

No asumir potencia constante (`150 kW × 30 min ≠ 75 kWh`).

```text
P(soc) = min(curva(soc) interpolada linealmente, availablePowerKw)
Integrar en pasos ΔSOC (default 0.5 %):  Δt = (ΔSOC / 100) × usableCapacity / P(soc)
Tiempo de parada = Σ Δt + connectionOverheadMinutes (configurable)
```

- Sin curva del vehículo: usar `fallbackChargingCurve` configurable, marcada `estimated`, e indicar `chargingTimeSource: 'estimated_curve'`.
- En AC, la potencia queda limitada por el cargador a bordo (vía `VehicleChargePort.maxPowerKw`).
- v1 asume que la potencia nominal de la estación es potencia entregada; no se modelan pérdidas de carga (documentarlo).

#### 5.8.5 Optimización (lexicográfica, sin puntuación arbitraria)

**Restricciones duras** (viabilidad y seguridad): pisos de SOC con margen de energía (5.8.2).

**Objetivo lexicográfico**, en este orden:

1. menor número de paradas;
2. menor tiempo adicional total (carga + conexión + desvío);
3. menor distancia de desvío;
4. mayor SOC mínimo del plan (margen de seguridad) como desempate final.

**Algoritmo sugerido:** programación dinámica / label-setting sobre los nodos (origen, candidatas compatibles ordenadas por `distanceAlongRouteKm`, destino) con estado `(nodo, SOC de salida discretizado)`, con resolución configurable (default 1 %). La estrategia greedy de "la estación más lejana alcanzable" no garantiza el óptimo cuando la carga es variable y la curva de carga decrece.

Modo ponderado opcional, **desactivado por defecto**: si se activa, los pesos deben estar en `PlannerConfig`, en unidades homogéneas (minutos equivalentes) y documentados en el plan.

#### 5.8.6 Carga adicional antes de salir

- `requiredInitialSocPercent` = mínimo SOC inicial para el cual el planner encuentra un plan viable. Se obtiene con búsqueda binaria sobre el SOC inicial reutilizando el mismo planner (la viabilidad es monótona en el SOC inicial). Así se responde "¿puede alcanzar la primera estación?" sin fijar de antemano cuál es la primera.
- `additionalInitialChargeRequiredPercent = max(0, requiredInitialSoc − currentSoc)`.
- Si `requiredInitialSoc > 100 %` → no viable incluso con la batería llena.
- Mensaje (el porcentaje se redondea hacia arriba al presentar): *"Necesitas cargar al menos {X} % antes de salir para alcanzar la primera estación de carga."*
- Usa el mismo `EnergyProfile` y `simulateSoc`. No hay cálculo de consumo paralelo.

```ts
interface ChargingStop {
  stationId: string;
  stationName?: string;
  location: Coordinate;
  distanceAlongRouteKm: number;
  detourKm: number;
  detourSource: 'estimated' | 'calculated';      // calculated tras la pasada 2
  compatibility: CompatibilityOption;
  arrivalSocPercent: number;
  departureSocPercent: number;
  energyToChargeKWh: number;
  chargingMinutes: number;                       // incluye connectionOverhead
  averageChargingPowerKw: number;
  chargingTimeSource: 'vehicle_curve' | 'estimated_curve';
}

interface ChargingPlanResult {
  feasible: boolean;
  stops: ChargingStop[];
  requiredInitialSocPercent: number;
  additionalInitialChargeRequiredPercent: number;
  reachableStationIds: string[];
  compatibleStationIds: string[];
  adapterRequiredStationIds: string[];
  infeasibilityReason?: InfeasibilityReason;
  objective: {
    stops: number;
    totalChargingMinutes: number;
    totalDetourKm: number;
    totalDetourMinutes: number;
    minimumSocMarginPercent: number;
  };
}
```

### 5.9 RouteFeasibilityEngine

**Pregunta:** ¿Es posible realizar esta ruta bajo estas condiciones?

No calcula energía ni selecciona estaciones. Clasifica y valida la coherencia entre el `SOCProfile` final (con cargas) y el `ChargingPlanResult`. Responsabilidad: el planner **calcula**; este engine **clasifica y verifica**.

```ts
type FeasibilityStatus =
  | 'FEASIBLE_NO_CHARGING'
  | 'FEASIBLE_ONE_STOP'
  | 'FEASIBLE_MULTIPLE_STOPS'
  | 'INFEASIBLE_WITH_CURRENT_SOC'     // viable si se carga antes de salir (≤ 100 %)
  | 'INFEASIBLE_EVEN_AT_FULL_SOC';

type InfeasibilityReason =
  | 'INITIAL_SOC_INSUFFICIENT'
  | 'GAP_BETWEEN_STATIONS_EXCEEDS_RANGE'
  | 'NO_COMPATIBLE_STATIONS_IN_CORRIDOR'
  | 'DESTINATION_RESERVE_UNREACHABLE'
  | 'PLAN_VALIDATION_FAILED';

interface RouteFeasibilityResult {
  feasible: boolean;
  status: FeasibilityStatus;
  reasonCode?: InfeasibilityReason;
  reason?: string;                    // texto derivado del código, solo presentación
  minimumSocPercent: number;
  minimumSocDistanceKm: number;
  destinationSocPercent: number;
  additionalInitialChargeRequiredPercent: number;
  blockingSegment?: { fromKm: number; toKm: number };   // tramo que impide la viabilidad
}
```

Los errores de datos o de proveedores **no** son un `FeasibilityStatus`.

### 5.10 Agregación para visualización

La visualización no calcula nada: renderiza series producidas en el dominio por una función pura `buildChartSeries(energyProfile, socProfile, windowKm)`.

- `windowKm` automático según la longitud de la ruta (tabla configurable, p. ej. < 50 km → 1 km; 50–200 km → 2 km; > 200 km → 5 km).
- Los segmentos que cruzan el borde de una ventana se prorratean por distancia.
- Consumo: `kWh/100 km = energía neta en la ventana / distancia de la ventana × 100` (puede ser negativa en bajadas). Opcionalmente, una serie de consumo bruto.
- SOC vs. distancia desde el `SOCProfile`, con los saltos de cada carga.
- Ambas series provienen de la misma simulación. Invariante: la suma de las ventanas es igual al total.

---

## 6. Resultado final

```ts
interface EVRoutePlan {
  route: Route;

  distanceKm: number;
  drivingDurationMinutes: number;       // del perfil de velocidad, sobre la ruta real con desvíos
  chargingDurationMinutes: number;      // incluye conexión
  totalDurationMinutes: number;
  providerDurationMinutes: number;      // referencia

  energyConsumedKWh: number;
  energyRegeneratedKWh: number;         // aceptado por la batería
  regenCurtailedKWh: number;
  netEnergyConsumedKWh: number;
  averageConsumptionKWhPer100Km: number;  // neto: netEnergy / distance × 100

  initialSocPercent: number;
  destinationSocPercent: number;
  minimumSocPercent: number;
  minimumSocDistanceKm: number;

  routeIsFeasible: boolean;
  feasibility: RouteFeasibilityResult;
  additionalInitialChargeRequiredPercent: number;

  chargingStops: ChargingStop[];

  energyProfile: EnergySegment[];
  socProfile: SOCPoint[];

  assumptions: { parameter: string; value: unknown; source: DataSource; reference?: string }[];
  dataQuality: {
    speedLimitCoveragePercent: number;
    trafficCoveragePercent: number;
    elevationClampedPercent: number;
    providerDistanceDeviationPercent: number;
    providerDurationDeviationPercent: number;
    stationsWithUnknownPower: number;
  };
  warnings: string[];                   // códigos, no texto libre
  alternativesSummary?: { routeId: string; distanceKm: number; stops: number; totalDurationMinutes: number; feasible: boolean }[];

  modelVersion: string;
  providerSnapshots: { routing: string[]; elevation: string[] };
  inputHash: string;
}
```

---

## 7. Parámetros configurables (`ModelParameters`)

Todos centralizados, versionados y con `SourcedValue` cuando representen un supuesto físico:

- `fineGridStepM`, `energySegmentLengthM`
- `elevationSmoothingWindowM`, `maxAbsGradePercent`
- `defaultSpeedByRoadClass`, `drivingModeParams`, `regenModeParams`
- `rotationalInertiaFactor` (si no viene del vehículo)
- `maxLateralDistanceKm`, `detourRoadFactor`, `detourConsumptionWindowKm`
- `socDiscretizationPercent`, `maxPlanningIterations`, `allowChargeAboveTarget`
- `connectionOverheadMinutes`, `unknownPowerPolicy`, `fallbackChargingCurve`
- `regenSocCeilingPercent`
- `chartWindowByRouteLength`

---

## 8. Caso de prueba obligatorio: Piedecuesta → Vélez

### 8.1 Escenario

| Campo | Valor | Tipo |
|---|---|---|
| Origen | Piedecuesta, Santander — [COMPLETAR coordenadas verificadas] | configurable |
| Destino | Vélez, Santander — [COMPLETAR coordenadas verificadas] | configurable |
| Vehículo | [COMPLETAR marca, modelo, versión y año] | — |
| Peso en vacío | 1672 kg — [COMPLETAR fuente] | manufacturer / external_source |
| Ocupantes | 150 kg | configurable |
| Equipaje | 30 kg | configurable |
| Masa total | 1852 kg | calculated |
| Batería | 47.1 kWh — [COMPLETAR: ¿bruta o utilizable? fuente] | manufacturer / external_source |
| Puerto(s) de carga | [COMPLETAR conector, AC/DC, potencia máx.] | manufacturer |
| Adaptadores del usuario | [COMPLETAR o lista vacía] | configurable |
| Conducción | normal | configurable |
| Regeneración | media | configurable |
| Aire acondicionado | activo | configurable |
| SOC inicial | [COMPLETAR; propuesto 80 %] | configurable |
| Temperatura | [COMPLETAR; propuesto 25 °C] | configurable |
| `minimumArrivalSocPercent` | 10 % | configurable |
| `destinationReserveSocPercent` | 10 % | configurable |
| `maxChargeTargetSocPercent` | [propuesto 80 %] | configurable |
| Estaciones | snapshot fijo del listado existente (fixture) | — |

Las respuestas de Mapbox y del DEM se graban como fixtures. **Los tests no usan red.**

### 8.2 Tabla de parámetros con fuente (obligatoria en el informe)

| Parámetro | Valor | Tipo de fuente | Referencia |
|---|---|---|---|
| Cd | | | |
| Área frontal | | | |
| Crr | | | |
| Eficiencia drivetrain | | | |
| Eficiencia de regeneración | | | |
| Potencia máx. de regeneración | | | |
| Factor de inercia rotacional | | | |
| Batería utilizable | | | |
| Consumo auxiliar base | | | |
| Consumo del aire acondicionado | | | |
| Curva de carga | | | |

Distinguir siempre entre `manufacturer`, `external_source`, `calculated`, `estimated` y `configurable`. No presentar estimaciones como datos oficiales del vehículo.

### 8.3 Tests unitarios con resultado analítico

- Plano, velocidad constante, sin auxiliares: `E_batt = (Crr·m·g + 0.5·ρ·Cd·A·v²)·d / η`.
- Energía de pendiente: `Σ F_grade·d = m·g·(h_fin − h_ini)` exactamente.
- Ciclo 0 → v → 0 en plano, sin aero, rodadura ni auxiliares: `Σ E_wheel` = 0 y la energía neta de batería es `E_acel / η − E_regen` > 0.
- Recorte de regeneración al 100 % de SOC en una bajada.
- SOC negativo no recortado y `maxDeficitKWh` correcto.
- Compatibilidad: ejemplo CCS2 / CCS1 / GB/T, con y sin adaptador; potencia limitada por el adaptador.
- Curva de carga: tiempo 10 → 80 % integrado frente a un cálculo manual.
- Agregación: la suma de las ventanas es igual al total.
- Planner: el ejemplo A/B/C de 5.8.2 produce una sola parada en C.
- Los cinco `FeasibilityStatus`, cada uno con un `EnergyProfile` sintético (sin proveedores).
- Búsqueda de `requiredInitialSocPercent`: SOC actual 20 %, SOC requerido 34 % ⇒ 14 % adicional y mensaje correcto.

### 8.4 Invariantes (tests de integración sobre Piedecuesta → Vélez)

- `Σ segment.netEnergyKWh = netEnergyConsumedKWh − regenCurtailedKWh` (el perfil de energía lleva la regeneración potencial; el plan, la aceptada).
- `SOC_destino = SOC_0 + (Σ cargas − Σ consumido + Σ regeneración aceptada) / usable × 100`.
- Masa total usada = 1852 kg.
- Determinismo: dos ejecuciones con los mismos fixtures producen resultados deep-equal.
- No hay `Math.round` / `toFixed` fuera del módulo de presentación (comprobación estática).
- Sanidad (warning, no falla): consumo de sport ≥ normal ≥ efficient en la misma ruta; consumo medio dentro de un rango de plausibilidad configurable.

### 8.5 Informe de salida

Un Markdown con: el resumen del `EVRoutePlan`, la tabla de parámetros con fuente, las paradas, los datos de las gráficas (consumo por ventana y SOC vs. distancia), `dataQuality`, warnings y la lista de supuestos `estimated`.

---

## 9. Calibración (solo el contrato de datos)

```ts
interface TripObservation {
  planId: string;
  modelVersion: string;
  vehicleId: string;
  tripConfiguration: TripConfiguration;
  observedSoc: { distanceKm: number; socPercent: number; timestamp?: string }[];
  observedEnergyKWh?: number;
  observedSpeedsKmh?: { distanceKm: number; speedKmh: number }[];
}
```

Parámetros candidatos a calibrar: `Crr`, `drivetrainEfficiency`, `regenEfficiency`, `captureFraction` por modo, auxiliares y aire acondicionado, `rotationalInertiaFactor` y parámetros de conducción por modo. Un valor calibrado pasa a `source: 'calculated'` con referencia al conjunto de viajes usado.

---

## 10. Fases de implementación

| Fase | Contenido | Criterio de salida |
|---|---|---|
| F1 | Tipos, `SourcedValue`, unidades, utilidades geo y de remuestreo | Tests de conversión y remuestreo en verde |
| F2 | EnergyEngine + SOCEngine con perfiles sintéticos | Tests analíticos de 8.3 en verde |
| F3 | Providers (Mapbox, DEM) con fixtures; RouteEngine y ElevationEngine | Snapshots reproducibles; limpieza del DEM probada |
| F4 | SpeedProfileEngine | Límites de modo, curvatura y paradas respetados |
| F5 | StationCorridorEngine + StationCompatibilityEngine | Casos de compatibilidad en verde |
| F6 | ChargingPlanner + RouteFeasibilityEngine | Cinco estados de viabilidad y ejemplo A/B/C en verde |
| F7 | Orquestador (2 pasadas), `buildChartSeries`, `EVRoutePlan` | Invariantes de 8.4 en verde |
| F8 | Caso Piedecuesta → Vélez end-to-end + informe | Informe generado con la tabla de fuentes completa |

**Definition of Done en todas las fases:** tests en verde, engines sin I/O, sin redondeo en el dominio, tipos estrictos, y un ADR por cada decisión no cubierta por esta especificación.

---

## 11. Responsabilidades

| Componente | Pregunta que responde | No hace | I/O |
|---|---|---|---|
| RouteEngine | ¿Por qué carretera debo ir? | Energía, SOC, carga | Sí (vía provider) |
| ElevationEngine | ¿Cómo cambia la altitud? | Energía, velocidades | Sí (vía provider) |
| SpeedProfileEngine | ¿A qué velocidad y con qué aceleraciones? | Energía, SOC | No |
| EnergyEngine | ¿Cuánta energía consume o recupera cada segmento? | SOC, decisión de carga | No |
| SOCEngine | ¿Cómo evoluciona la batería? | Decidir dónde cargar | No |
| StationCorridorEngine | ¿Dónde queda cada estación respecto a la ruta? | Compatibilidad, selección | No |
| StationCompatibilityEngine | ¿Puedo cargar aquí y necesito adaptador? | Elegir estación | No |
| ChargingPlanner | ¿Dónde paro y cuánto cargo? | Recalcular consumo, buscar estaciones | No |
| RouteFeasibilityEngine | ¿Es posible la ruta bajo estas condiciones? | Energía, estaciones | No |
| `buildChartSeries` | ¿Qué se grafica? | Cálculos físicos | No |
| EVRoutePlanningService | Orquesta el pipeline | Lógica de dominio propia | Solo a través de providers |
