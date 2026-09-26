# Voltia frente al plan del motor de rutas EV — revisión

Revisión del código en `main` (commit `d7b3651`) contra la especificación "EV Route Planning Engine v2". El plan reescrito para este repo está en [`02-plan-arquitectura-modular.md`](./02-plan-arquitectura-modular.md).

## Resumen

La base es mejor de lo que suele encontrarse: el dominio es puro y no importa infraestructura, el listado de electrolineras ya es un pipeline serio (fuentes, deduplicación, consolidación, elegibilidad, versión) y el modelo de energía ya tiene densidad del aire por altitud, viento y auxiliares bien cobrados.

Los problemas están en tres sitios:

1. **Correctitud del planificador.** Hay rutas que se declaran viables aunque la batería baja de la reserva a mitad de camino, el SOC mostrado no descuenta los desvíos a los cargadores y el tiempo de carga sale inflado en cargadores lentos. Todos verificados ejecutando el código (sección "Errores verificados").
2. **Modelo físico.** El estilo de conducción y un "factor de ciclo" son multiplicadores sobre el consumo, y Cd·A, Crr y eficiencia se deducen del peso y la potencia del motor. Justo lo que el plan prohíbe.
3. **Acoplamiento.** No hay puertos para rutas, elevación ni clima; el proveedor de rutas arma el muestreo y el perfil de velocidad; energía y SOC se calculan juntos y dependen uno del otro; el planificador (930 líneas) hace de todo.

## Cómo se revisó

- Lectura de `src/domain`, `src/infrastructure/providers`, `src/infrastructure/stations`, `src/server/actions/plan.ts`, `src/lib/store.ts`, componentes del planificador, `seeds/` y `docs/calculo-consumo-energia.md`.
- **No se pudo correr la suite** (`npm ci` devolvió 403 del registro de npm en el entorno de revisión). Para no depender de suposiciones, el código de dominio se ejecutó directamente con Node 22 (`--experimental-strip-types`) y un resolvedor de rutas `@/`. El código de cada prueba está en el apéndice.

---

## Lo que está bien (conservar)

| Qué | Dónde | Por qué importa |
|---|---|---|
| Dominio puro e isomórfico. Ningún archivo de `src/domain` importa `@/infrastructure`, `@/lib`, `next` ni React. | `src/domain/**` | Es el requisito base del plan. Permite que el store recalcule en el cliente sin volver a pedir rutas (`src/lib/store.ts:136`). |
| Pipeline de electrolineras: registro de fuentes, normalización, deduplicación, fusión campo a campo con conflictos, elegibilidad con motivos, dataset versionado en Postgres con lock y stale-while-revalidate. | `src/infrastructure/stations/*`, `src/domain/stations/*` | Es "el listado existente" del plan. Ya tiene la interfaz `StationSource` (`sources/types.ts`), que es el patrón a copiar para rutas y elevación. |
| Física de aire: densidad por altitud y temperatura, gradiente térmico, viento proyectado sobre el rumbo. | `src/domain/energy.ts` (`airDensity`, `segmentTempC`, `airSpeedSq`) | Más completo que lo que pide el plan (el viento quedaba como extensión futura). |
| Auxiliares cobrados siempre, también en bajada; gravedad con signo; regeneración solo del excedente y con tope de potencia. | `energy.ts:260`, `energy.ts:275-286` | Evita el error clásico de cobrar auxiliares solo con potencia positiva. |
| Catálogo de vehículos con fuente por cifra, distinción neta/bruta anotada (MG S5: 47,1 kWh neta, 49 bruta) y test que compara el respaldo con el seed. | `seeds/0001_vehicle_catalog.sql`, `src/seeds.test.ts` | Base directa para la trazabilidad (`SourcedValue`) del plan. |
| Rutas: decisión documentada de usar `driving` y no `driving-traffic` (caso Piedecuesta → Vélez), jerarquía vial con corrección de atajos, alternativa sin peajes, avisos de "snap", token redactado, respuestas validadas con Zod. | `src/infrastructure/providers/routing*.ts`, `src/domain/road-hierarchy.ts` | Valor propio del producto que el plan no pedía; hay que preservarlo al desacoplar. |
| Carga antes de salir con búsqueda binaria y redondeo hacia arriba. | `planner.ts:600-726` | Coincide con la intención del plan (con un error de borde, C5). |
| Compatibilidad con adaptadores, opción AC de respaldo, límites AC/DC del vehículo y lista de opciones por parada. | `src/domain/charging.ts` | Buena base para el `StationCompatibilityEngine`. |
| Más de 170 tests, CI con typecheck, lint y umbral de cobertura 80/70. | `.github/workflows/ci.yml`, `vitest.config.ts` | Red de seguridad para migrar por fases. |

---

## Errores verificados

Cada uno se reprodujo ejecutando el código del repo (apéndice). Vehículo de las pruebas: MG S5 EV Deluxe del catálogo (47,1 kWh, 1672 kg).

### C1. Se aprueban rutas que bajan de la reserva a mitad de camino — crítico

- **Qué pasa:** el planificador solo compara el SOC de **llegada** (a un cargador o al destino) con la reserva. No mira el mínimo intermedio. En montaña, la bajada final "devuelve" batería y tapa el hueco de la cima.
- **Dónde:** `planner.ts:197` (sale sin paradas si la llegada al destino cumple), `planner.ts:214` (`canReachDestFrom`), `planner.ts:541`.
- **Evidencia:** subida de 1500 m en 40 km y bajada en 20 km, SOC inicial 31 %, reserva 10 %: `feasible: true`, 0 paradas, **SOC mínimo 3,0 %**, llegada 10,6 %.
- **Impacto:** es el caso típico de Santander (cañón del Chicamocha). El usuario ve "viable sin paradas" y la batería queda en 3 % en el alto.
- **Arreglo:** el piso de SOC se evalúa en todos los puntos del tramo (SOCEngine del plan, `violatesMinimumSoc`).

### C2. El SOC de la gráfica y el SOC de llegada no descuentan los desvíos — alto

- **Qué pasa:** la energía del desvío a cada cargador se usa para calcular `arriveSoc` de la parada, pero `applyStopsToSamples` reconstruye la curva solo con la energía de la vía. Tras cada parada la curva queda por encima del plan en `detourKwh / batería`, y el error se acumula hasta el destino.
- **Dónde:** `planner.ts:561-577`; también `energyKwh` y `avgKwhPer100km` excluyen el desvío (`planner.ts:857`, `planner.ts:860`).
- **Evidencia:** ruta de 300 km, cargador a 10 km de la vía (desvío 19,9 km): `departSoc` 55,6 %, pero la curva justo después de la parada marca **60,2 %**. La llegada al destino se muestra 4,7 puntos más alta de lo que el propio plan calculó.
- **Arreglo:** los desvíos entran como tramos del perfil de energía (pasada 2 del plan) o, como mínimo, como eventos de energía en la simulación de SOC.

### C3. Tiempo de carga inflado en cargadores más lentos que el auto — medio

- **Qué pasa:** `chargeTimeMinutes` aplica el factor de la curva sobre `min(potencia del auto, potencia del cargador)`. Debe ser `min(potencia del auto × factor(SOC), potencia del cargador)`: un cargador de 50 kW sigue entregando 50 kW mientras la curva del auto esté por encima.
- **Dónde:** `charging.ts:49`.
- **Evidencia:** MG S5 (120 kW) de 20 a 80 % en un cargador de 50 kW: el código da **42,6 min**; con la fórmula correcta, **33,9 min** (+26 %).
- **Impacto:** en Colombia la mayoría de cargadores DC son de 40–60 kW, así que el error afecta casi todas las paradas y también la selección entre ellas.

### C4. Adaptadores que el usuario quizá no tiene; GB/T AC tratado como DC — alto

- **Qué pasa:**
  - `VERIFIED_DC_ADAPTERS` (GB/T → CCS2 y CCS1 → CCS2) se aplica a todo vehículo con CCS2. El campo `vehicle.adapters` existe en el esquema (`schemas.ts:45`) pero el planificador no lo lee (`charging.ts:62-100`). La ruta puede mandar a alguien a una estación que solo sirve con un adaptador que no tiene.
  - No se modela el límite de potencia del adaptador.
  - `gb_t` siempre se clasifica como DC (`stations/connectors.ts:36`) y `toPlanningCharger` descarta el tipo de corriente. Una toma GB/T de AC podría proponerse con el adaptador DC.
- **Arreglo:** los adaptadores salen de la configuración del usuario, con corriente y potencia máxima; el conector de la estación conserva `current`.

### C5. SOC inicial con decimales → "imposible incluso al 100 %" — bajo

- **Qué pasa:** en `assessFirstCharger`, si `current + floor(100 − current) < 100` se salta la búsqueda binaria y pide `ceil(100 − current)`, lo que da un SOC de salida mayor que 100 y marca la ruta como imposible.
- **Dónde:** `planner.ts:698-702`.
- **Evidencia:** misma ruta y cargador: con SOC 20 pide +32 % y es viable; con **SOC 20,5** devuelve `firstChargerUnreachable: true`.
- **Alcance:** el slider usa pasos de 1, pero el esquema acepta decimales (`schemas.ts:61`), así que llega por la API o por viajes guardados.

### C6. La energía de un tramo depende del SOC con el que se calculó — medio

- **Qué pasa:** el recorte de regeneración por batería llena (`effectiveRegen`, `energy.ts:139`) vive dentro del motor de energía. El perfil se calcula una vez con la trayectoria de SOC **sin cargas** (`planner.ts:760`) y se reutiliza después de cada parada, cuando el SOC real es otro.
- **Evidencia:** la misma bajada de 1400 m en 70 km cuesta 1,49 / 1,63 / 2,04 kWh netos según se empiece con 60 / 85 / 95 %.
- **Consecuencia adicional:** `assessFirstCharger` tiene que re-anotar toda la ruta por cada SOC probado (`planner.ts:654-663`), porque la energía cambia con el SOC.
- **Arreglo del plan:** el EnergyEngine produce la regeneración potencial; el SOCEngine la recorta según el SOC.

### C7. Potencia asumida indistinguible de la reportada — medio

- **Qué pasa:** si ninguna fuente reporta potencia, `mergeConnectors` asigna 50 / 22 / 150 kW por estándar (`merge.ts:58-63`) y la estación pasa la elegibilidad igual que una con potencia medida. El plan y la UI no pueden decir "potencia estimada".
- **Arreglo:** guardar el origen de la potencia (`reported` / `assumed`) igual que ya se hace con `currentOrigin`, y exponerlo como `SourcedValue` en la compatibilidad.

### C8. El panel de batería y el planificador usan pisos distintos — bajo

- **Qué pasa:** `batteryBudget` (panel de batería) toma como piso `max(margen, vehicle.minSocRecommended, arrivalSoc)`; el planificador usa solo el margen para los cargadores y `max(arrivalSoc, margen)` para el destino, e ignora `minSocRecommended`.
- **Dónde:** `energy.ts:443-447` frente a `planner.ts:181-189`.
- **Efecto:** con el MG S5 (`minSocRecommended` 15) y margen "bajo" (10 %), el panel avisa con 15 % y el plan permite llegar a los cargadores con 10 %.
- **Arreglo:** una sola función que traduzca las condiciones a pisos (`toTripConfiguration` en el plan) y que usen ambos.

---

## Diferencias de diseño frente al plan

| # | Qué hace hoy | Dónde | Qué pide el plan |
|---|---|---|---|
| D1 | El estilo multiplica rodadura + aire (eficiente 0,95, deportivo 1,08), sobre un factor de ciclo de 1,14 y un factor de clima sobre la tracción. A igual velocidad (90 km/h, llano): eficiente 15,8, normal 16,6, deportivo 17,7 kWh/100 km. | `energy.ts:9`, `energy.ts:34`, `energy.ts:273`, `energy.ts:281` | El modo cambia velocidad y aceleración; la física calcula el efecto. Nada de `consumo × factor`. |
| D2 | Cd·A, Crr y eficiencia del tren se derivan del peso y de `motorKw`; la regeneración se topa al 40 % de `motorKw`. | `energy.ts:117-131`, `energy.ts:285` | Potencia y torque no entran al consumo. Coeficientes del vehículo con fuente; si se estiman, marcados `estimated`. |
| D3 | Sin término de aceleración. La velocidad de cada muestra es la media del motor de rutas en ~1 km, recortada a 8–130 km/h y multiplicada por el estilo (0,93 / 1 / 1,06). Solo se piden anotaciones `distance,duration`. | `routing.osrm.ts:136-162`, `routing.mapbox.ts:68`, `planner.ts:741-747` | SpeedProfileEngine con límites de velocidad, curvatura, aceleración y frenado por modo. |
| D4 | Elevación con 96 puntos por ruta sin importar su largo (212 km → uno cada ~2,2 km), interpolación lineal y media móvil de 5 muestras. Sin tratamiento de túneles ni puentes, sin límite de pendiente. Si falla, la ruta queda plana (0 m) en silencio y solo se agrega un aviso. | `elevation.openmeteo.ts:16`, `:52`, `:60`, `:86` | Malla fina (~50 m), limpieza (túneles, puentes, suavizado, límite de pendiente) y error tipado. |
| D5 | Tramos de energía de `max(0,8 km, distancia/220)`. | `routing.osrm.ts:171` | 100–500 m configurable. |
| D6 | Selección de paradas por puntaje con pesos sin documentar (potencia, llegada, precio, fuente, disponibilidad), una cascada de filtros (`narrow`), ventana de llegada ≤ 40 % y tope de 7 paradas. Greedy. | `planner.ts:142-167`, `:256-284`, `:280`, `:34` | Optimización lexicográfica documentada (viabilidad → seguridad → paradas → tiempo → desvío), sin puntajes arbitrarios. |
| D7 | Proyección de estaciones duplicada: `findStationsNearRoute` en la acción y `attachChargersToRoute` en el planificador, ambos contra muestras (no contra segmentos). Desvío = 2 × distancia en línea recta. | `server/actions/plan.ts:58`, `planner.ts:58-81` | Un solo StationCorridorEngine; desvío estimado con factor vial y reemplazado por el real en la pasada 2. |
| D8 | El planificador llama al motor de energía para el desvío: llano, 50 km/h, sin elevación. | `planner.ts:135` | El planificador no recalcula consumo; el desvío sale del perfil o de la ruta real. |
| D9 | Motivos de no viabilidad como texto libre; la viabilidad se decide dentro del planificador. Con `allowBelowSafety` devuelve `feasible: true` sin paradas aunque no haya cargador. | `domain/types.ts:334-339`, `planner.ts:209` | Códigos enumerados y RouteFeasibilityEngine separado. |
| D10 | `batteryKwh` es la capacidad neta por convención del seed, pero el modelo no tiene campos bruta/útil y `docs/calculo-consumo-energia.md` dice "no distingue". | `schemas.ts:35` | `usableBatteryCapacityKWh` y `batteryCapacityKWh` explícitos. |
| D11 | La fuente de cada dato del vehículo vive en comentarios SQL, no en los datos. | `seeds/0001_vehicle_catalog.sql` | `SourcedValue` por parámetro y lista de supuestos en el plan. |
| D12 | Gráfica de consumo = promedio acumulado desde el km 0; bloques de 100 km. | `consumption-chart.tsx:19-24`, `energy.ts:498` | Ventanas de 1–5 km con prorrateo, producidas en el dominio. |

---

## Acoplamiento

| # | Problema | Dónde | Efecto |
|---|---|---|---|
| A1 | No hay puertos para rutas, elevación ni clima. La acción del servidor importa módulos concretos con `import()` y compone todo allí. | `server/actions/plan.ts:29-35` | No se puede cambiar Mapbox ni el DEM sin tocar la acción; los tests de integración necesitan red. |
| A2 | El proveedor de rutas arma el muestreo y el perfil de velocidad (`toRawRoute` → `buildSamples` + `applySegmentSpeeds`); el de elevación calcula pendientes y desnivel. Ambos escriben en `RawRoute.samples`. | `routing.osrm.ts:234-259`, `elevation.openmeteo.ts:48-89` | Lógica de dominio en infraestructura; cambiar de proveedor cambia el modelo. |
| A3 | El proveedor de Mapbox reutiliza el esquema de OSRM. | `routing.mapbox.ts:3` | Un cambio en OSRM rompe Mapbox. |
| A4 | `RouteSample` mezcla geometría, elevación, velocidad, energía y SOC; `RoutePlan` mezcla ruta, energía, SOC, paradas, itinerario y textos. | `domain/types.ts:40-53`, `domain/types.ts:203-247` | Todas las etapas escriben el mismo objeto; no hay contratos entre etapas. |
| A5 | `planner.ts` hace proyección de estaciones, compatibilidad, energía de desvíos, SOC, carga previa, itinerario y datos para el ranking. | `src/domain/planner.ts` (930 líneas) | Imposible probar una responsabilidad sin las demás. |
| A6 | Energía y SOC se calculan en el mismo bucle (`annotateEnergy`) y el SOC se recorta a 0–100. | `energy.ts:371-419` | No se puede medir el déficit (cuánto falta) ni reutilizar el perfil con otras cargas (C6). |
| A7 | Clima "actual" en un solo punto (la mitad de la ruta); los viajes guardados y compartidos se recalculan con datos vivos. | `weather.openmeteo.ts:14`, `server/actions/plan.ts:42` | Resultados no reproducibles; el mismo viaje compartido cambia con el tiempo. |
| A8 | El store del cliente re-ejecuta `buildPlan` en cada cambio de condiciones. | `lib/store.ts:136-157` | Es una ventaja (respuesta instantánea) y solo funciona porque el dominio es puro. Hay que formalizarlo: una función pura `computePlan(snapshot, …)` compartida por servidor y cliente. |

---

## Qué existe y qué falta frente al plan

| Componente del plan | Estado | Base en el repo |
|---|---|---|
| RouteEngine / `RoutingProvider` | Parcial: funciona, sin interfaz | `routing.ts`, `routing.mapbox.ts`, `routing.osrm.ts` |
| ElevationEngine / `ElevationProvider` | Parcial: sin interfaz, muestreo grueso, sin limpieza | `elevation.openmeteo.ts` |
| SpeedProfileEngine | Falta: hay velocidades medias del proveedor | `applySegmentSpeeds` |
| EnergyEngine | Parcial: buena física de aire; multiplicadores y coeficientes inferidos | `energy.ts` |
| SOCEngine | Falta como módulo: acoplado a energía | `annotateEnergy`, `applyStopsToSamples` |
| StationCorridorEngine | Duplicado | `stations/spatial.ts`, `attachChargersToRoute` |
| StationCompatibilityEngine | Parcial: adaptadores globales, sin corriente | `charging.ts` |
| ChargingPlanner | Parcial: greedy con puntaje | `planner.ts` |
| Curva de carga | Parcial: error C3; curva genérica | `charging.ts` |
| RouteFeasibilityEngine | Falta: mezclado en el planificador | `planner.ts` |
| Serie para gráficas en el dominio | Parcial | `consumptionBlocks` |
| Trazabilidad de datos (`SourcedValue`) | Falta en datos (existe en comentarios) | seed |
| Determinismo / snapshots | Parcial: `stationsVersion` ya existe | `GeoBundle` |
| Caso Piedecuesta → Vélez | Parcial: citado en código, sin test de extremo a extremo | `routing.mapbox.ts:7-11` |

---

## Prioridades

1. **Ya (correcciones pequeñas sobre el código actual):** C1, C2, C3, C5, C8. Cada una es un cambio localizado con su test.
2. **Siguiente:** C4 y C7 (datos de adaptadores y potencia) y los puertos (A1). Sin puertos, el resto de la migración no se puede probar sin red.
3. **Migración por fases:** separar SOC de energía (A6, C6), luego perfil de velocidad y física sin multiplicadores (D1–D3), luego planificador lexicográfico (D6). El orden y los criterios de cierre están en el plan.

---

## Apéndice: reproducción

Se ejecutó con Node 22 sin dependencias: `node --experimental-strip-types --import ./register.mjs probes.ts`, donde `register.mjs` registra un resolvedor que traduce `@/` a `src/` y agrega la extensión `.ts`. Fragmentos:

```ts
// C1 — montaña: sube 1500 m en 40 km, baja en 20 km, 60 km/h, regeneración alta
const prof = (km: number) => (km <= 40 ? 500 + (1500 * km) / 40 : 2000 - (1500 * (km - 40)) / 20);
buildPlan({ raw: route(prof, 60), vehicle: mgS5Deluxe,
  conditions: cond({ initialSoc: 31, arrivalSoc: 10, safetyMode: "low" }), chargers: [], ... });
// → { feasible: true, stops: 0, minSoc: 3.0, arrivalSoc: 10.6 }

// C2 — 300 km en llano, cargador a ~10 km de la vía en el km 150
// → stop.departSoc 55.57, SOC de la curva tras la parada 60.23

// C3
chargeTimeMinutes(47.1, 20, 80, 120, 50, DEFAULT_CURVE);            // 42.6 min
// Σ ΔE / min(50, 120 × factor(SOC))                                  // 33.9 min

// C5 — misma ruta, cargador en el km 160
cond({ initialSoc: 20 })   // → departureCharge +32 %, viable
cond({ initialSoc: 20.5 }) // → firstChargerUnreachable: true

// C6 — bajada de 1400 m en 70 km
annotateEnergy(samples, ctx, 60 | 85 | 95)  // → 1.49 | 1.63 | 2.04 kWh netos

// D1 — 100 km en llano a 90 km/h, misma velocidad
segmentEnergyBreakdown(100, 0, 90, ctx(efficient | normal | sport))  // → 15.82 | 16.55 | 17.73 kWh
```

Estos casos deberían entrar como tests de regresión en la fase 0 del plan.
