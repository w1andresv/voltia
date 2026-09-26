# Plan de trabajo por fase del motor de rutas EV v2

Guía operativa para ejecutar las fases F1–F9 de [`02-plan-arquitectura-modular.md`](./02-plan-arquitectura-modular.md) (el "plan"). El qué y el porqué están en el plan y en la [especificación v2](./prompt_ev_route_engine_v2.md). Aquí va el **cómo**: ramas, orden, tareas, archivos, tests, criterio de cierre y lo que falta decidir antes de cada fase.

---

## 1. Qué ya está listo (F0)

| Pieza | Dónde | Para qué sirve en las fases |
|---|---|---|
| Rama de integración `engine-v2` | GitHub | Cada fase es un commit en esta rama; `main` recibe el resultado al final (ADR-0001) |
| CI en `engine-v2` | `.github/workflows/ci.yml` | typecheck, lint, cobertura (≥ 80/80/80/70), tests de scripts y build. Verde desde `c6c50fa` |
| Hook de inicio de sesión | `.claude/hooks/session-start.sh` | Cada sesión web instala dependencias sola. Se activa para todas las sesiones al llegar a `main` |
| Correcciones C1, C2, C3, C5, C8 y el redondeo al llegar | `src/domain/planner.ts`, `charging.ts`, `types.ts` | Línea base correcta contra la que se compara el motor nuevo |
| Cd·A y Crr por carrocería y por vehículo | `energy.ts`, seed | Parámetros físicos con fuente "estimated", listos para `SourcedValue` (ADR-0002) |
| Regla de ESLint del dominio | `eslint.config.mjs` | `src/domain` no puede importar infraestructura ni el framework |
| Pipeline extraído | `src/server/plan-pipeline.ts` | Punto único de composición. En F1 lo reemplaza `EVRoutePlanningService` |
| Grabación y reproducción de proveedores | `src/test-support/` | Tests sin red y deterministas. El caso Piedecuesta → Vélez se activa al grabar la cassette |
| Caracterización con proveedores sintéticos | `src/test-support/characterization.test.ts` | Resultado completo del pipeline actual (huella y resumen) en 3 escenarios, sin red. Es el test de igualdad de F1 y F2 mientras no esté la cassette real |

## 2. Pendientes tuyos antes de F1

| # | Qué | Por qué | Cómo |
|---|---|---|---|
| P1 | **Grabar la cassette de Piedecuesta → Vélez** | F1 cierra con "misma respuesta que antes" sobre ese fixture. Sin él no hay test de igualdad ni modo sombra | En tu máquina, con `.env.local`: `npm run snapshot:record` y luego `npx vitest run src/test-support/piedecuesta-velez.test.ts` (crea el snapshot de referencia). Sube `src/test-support/fixtures/piedecuesta-velez.cassette.json` y `src/test-support/__snapshots__/`. Solo lee la base; no refresca el dataset |
| P2 | **Variables de entorno en la configuración del entorno** | `.env.local` vive solo en el contenedor de esta sesión | Menú del entorno en la barra de título de la sesión → Edit → variables de entorno. Las sesiones nuevas las leen |
| P3 | **Red para las sesiones que graben o prueben con proveedores reales** | Este entorno bloquea `api.mapbox.com`, `api.open-meteo.com`, `photon.komoot.io` | Misma pantalla → Network access: agregar esos dominios (y `api.opentopodata.org`, `router.project-osrm.org` si se usan). No hace falta para F1–F9 si la cassette ya está grabada |
| P4 | **Rotar la contraseña de la base** | Pasó por el chat | Supabase → Database → Reset password; actualizar `.env.local`, la configuración del entorno y Vercel |
| P5 | **Confirmar el escenario** (B4) | SOC inicial 80 %, 25 °C y sin adaptadores están en `src/test-support/scenarios.ts` como propuesta | Si cambia, regrabar (P1) |

## 3. Flujo de cada fase

1. Se trabaja directo en `engine-v2` (ADR-0001).
2. Leer la sección del plan de esa fase y la de la especificación que le corresponde (tabla 5).
3. Decisiones no cubiertas por el plan → ADR en `docs/adr/` antes del código.
4. Tests primero en lo que tiene resultado analítico (especificación §8.3).
5. Antes de commitear: `npm run typecheck && npm run lint && npm test`.
6. **Un commit por fase**, con el prefijo `F<N>:` y el criterio de cierre cumplido. CI corre en cada push a `engine-v2`.
7. Actualizar la tabla de estado (sección 6) en el mismo commit.

**Reglas que no se negocian:**
- Mientras `PLANNER_ENGINE` no sea `v2`, la app sigue respondiendo con el motor actual.
- Ningún test usa red: los proveedores se prueban con respuestas grabadas (`src/test-support/cassette.ts`).
- Nada de secretos en el repo: la grabación los verifica antes de escribir, pero revisar el diff igual.
- Si una fase cambia números que ve el usuario, el commit lo dice con antes y después sobre el fixture, y actualiza el snapshot de caracterización (`src/test-support/characterization.test.ts`) a propósito.
- Las fases que no deben cambiar resultados (F1, F2) dejan el snapshot de caracterización intacto.

## 4. Fases

### F1 · Contratos y puertos

- **Objetivo:** separar tipos, puertos y composición sin cambiar ningún resultado.
- **Tareas:**
  - [ ] `src/domain/ev/core/units.ts` (conversiones con tests) y `provenance.ts` (`DataSource`, `SourcedValue`).
  - [ ] `src/domain/ev/core/params.ts`: `ModelParameters` con `modelVersion`. Mover aquí `BODY_TYPE_PHYSICS`, `MAX_FROM_ROUTE_KM` y los umbrales del planificador, sin cambiar valores.
  - [ ] `src/domain/ev/core/trip-config.ts`: `TripConditions + Vehicle → TripConfiguration`, que absorbe `socFloors`.
  - [ ] `src/domain/ports/`: `RoutingProvider`, `ElevationProvider`, `WeatherProvider`, `StationCatalog` (plan §3.1).
  - [ ] Adaptadores que envuelven el código actual: `MapboxRoutingProvider`, `OsrmRoutingProvider`, `OpenMeteoElevationProvider`, `OpenMeteoWeatherProvider`, `DatasetStationCatalog`.
  - [ ] `src/application/plan-trip/service.ts` (`EVRoutePlanningService`) y `src/application/container.ts`. El servicio llama por dentro a `runPlanPipeline`/`buildPlan`.
  - [ ] `planTripFn` usa el servicio. Borrar `src/server/plan-pipeline.ts` o dejarlo como implementación interna del servicio.
  - [ ] Flag `PLANNER_ENGINE = legacy | shadow | v2` en `infrastructure/config/env.ts` (por defecto `legacy`).
  - [ ] Ampliar la regla de ESLint con los bloques de engines y de `components/lib/server` del plan §2.2.
- **Tests:** conversiones de unidades; `trip-config` (pisos iguales a `socFloors`); **igualdad** del servicio con el pipeline actual sobre la cassette.
- **Cierre:** misma respuesta que antes en el fixture (deep-equal); `server/actions` no importa proveedores.
- **Especificación:** F1 (tipos, `SourcedValue`, unidades).

### F2 · Snapshot y datos crudos

- **Objetivo:** que los proveedores solo traigan datos y el dominio muestree.
- **Tareas:**
  - [ ] Los proveedores devuelven `ProviderRoute` y elevaciones crudas (plan §3.1). Esquema de Mapbox separado del de OSRM (A3).
  - [ ] `engines/route/normalize.ts` (eje canónico) y `engines/elevation/engine.ts` (malla por distancia, limpieza, error tipado `ELEVATION_UNAVAILABLE`).
  - [ ] `PlanningSnapshot` (plan §3.2) reemplaza `GeoBundle`, con migración del store persistido (`lib/store.ts` ya versiona).
  - [ ] Grabación: la cassette pasa a guardar también el `PlanningSnapshot`.
- **Decisión previa (B6):** presupuesto de elevación. Teselas de terreno de Mapbox con caché, o malla adaptativa en Open-Meteo. Va en un ADR.
- **Tests:** contratos de adaptadores con respuestas grabadas; limpieza de elevación (túnel, puente, pendiente máxima); sin elevación → error, no ruta plana.
- **Cierre:** el caso Piedecuesta → Vélez sale del snapshot sin red.
- **Especificación:** F3 (providers con fixtures, RouteEngine y ElevationEngine).

### F3 · SOC separado de la energía

- **Objetivo:** que la energía de un tramo no dependa del SOC (C6).
- **Tareas:**
  - [ ] `engines/soc/simulate.ts`: recorte de regeneración por SOC, eventos de carga y desvío, piso en todo punto, déficit sin recortar a 0.
  - [ ] `annotateEnergy` deja de calcular SOC; `effectiveRegen` pasa al SOCEngine.
  - [ ] La carga previa reutiliza el perfil (ya no re-anota la ruta por cada SOC probado).
- **Tests:** especificación §8.3 sobre SOC: recorte al 100 %, SOC negativo y `maxDeficitKWh`.
- **Cierre:** la energía de la bajada de C6 es igual con 60, 85 y 95 %. Las diferencias con el motor actual quedan explicadas en el PR.
- **Especificación:** parte de F2 (SOCEngine).

### F4 · Corredor, compatibilidad y curva

- **Objetivo:** una sola proyección de estaciones y compatibilidad con los adaptadores que el usuario lleva (C4, C7).
- **Tareas:**
  - [ ] `engines/corridor/engine.ts`: distancia contra segmentos, desvío con fuente (`calculated` si viene de la matriz, `estimated` si no). Reemplaza `stations/spatial.ts` y `attachChargersToRoute`.
  - [ ] `engines/compatibility/engine.ts`: `vehicle.adapters ∩ VERIFIED_DC_ADAPTERS`, corriente del conector, límite de potencia del adaptador.
  - [ ] `StationConnector.powerOrigin` (`reported`/`assumed`) en `merge.ts`, y `current` y `powerOrigin` conservados en `toPlanningCharger`.
  - [ ] Casillas "llevo este adaptador" en `vehicle-editor.tsx`.
  - [ ] `engines/charging/curve.ts` (ya con el arreglo de C3), integración cada 0,5 % de SOC y `connectionOverheadMin`.
- **Tests:** CCS2 / CCS1 / GB/T con y sin adaptador; GB/T AC no usa adaptador DC; potencia asumida marcada.
- **Cierre:** C4 y C7 resueltos; `spatial.ts` y `attachChargersToRoute` eliminados.
- **Especificación:** F5 (corredor y compatibilidad).

### F5 · Energía v2 y perfil de velocidad

- **Objetivo:** física sin multiplicadores y con parámetros con fuente, detrás del modo sombra.
- **Tareas:**
  - [ ] `engines/energy/vehicle-params.ts`: cada parámetro como `SourcedValue` (Cd·A y Crr ya están en el vehículo).
  - [ ] `PhysicsEnergyModel` y `ManualConsumptionModel` intercambiables.
  - [ ] `engines/speed/engine.ts`: límites, curvatura, aceleración y frenado por modo; velocidad 0 en origen, destino y paradas.
  - [ ] Pedir a Mapbox las anotaciones `maxspeed` y `speed` (verificar formato vigente) y regrabar la cassette.
  - [ ] `PLANNER_ENGINE=shadow` en producción: registrar las diferencias en el log `[plan-trip]`.
- **Decisión previa:** datos físicos por vehículo (EPA para los Tesla, ficha para el resto). Se pueden cargar en el seed sin tocar código.
- **Tests:** llano `E = (Crr·m·g + ½ρCdAv²)·d/η`; pendiente `= m·g·Δh`; ciclo 0 → v → 0.
- **Cierre:** tests analíticos en verde; ADR con las diferencias de sombra explicadas.
- **Especificación:** F2 (EnergyEngine) y F4 (SpeedProfileEngine).

### F6 · Sin multiplicadores

- **Tareas:** borrar `STYLE_MULT`, `STYLE_SPEED_FACTOR`, `CYCLE_OVERHEAD`, `LegacyCycleFactor` y el uso de `motorKw` en eficiencia y regeneración.
- **Cierre:** `grep` sin esos símbolos; diferencias en sombra dentro del rango acordado en el ADR de F5.

### F7 · Planificador y viabilidad

- **Objetivo:** reemplazar la selección voraz por puntaje.
- **Tareas:**
  - [ ] `engines/charging/planner.ts`: tabla de tramos más programación dinámica sobre (nodo, SOC), con costo lexicográfico por `planningMode` (plan §4.9).
  - [ ] Carga previa por búsqueda binaria sobre la tabla de tramos.
  - [ ] `engines/feasibility/engine.ts`: los cinco estados y códigos de motivo. Los textos en español van a presentación.
  - [ ] `occupied` suma espera configurable; `offline` se excluye.
- **Tests:** ejemplo A/B/C de la especificación; los cinco estados con perfiles sintéticos; SOC actual 20 % y requerido 34 % dan +14 %.
- **Cierre:** menos de 150 ms por ruta con el fixture (medido en el test).
- **Especificación:** F6.

### F8 · Composición, gráficas y pasada 2

- **Tareas:**
  - [ ] `compute-plan.ts` (puro) usado por el servicio y por `lib/store.ts`.
  - [ ] `application/plan-trip/verify-plan.ts`: reruteo por las paradas, máximo 3 replanificaciones.
  - [ ] `engines/chart/series.ts`: ventanas con prorrateo; `consumption-chart.tsx` solo dibuja.
  - [ ] `legacy-adapter.ts` (`EVRoutePlan → RoutePlan`) para la UI actual.
  - [ ] Viajes guardados con su snapshot y `modelVersion`.
  - [ ] `PLANNER_ENGINE=v2`.
- **Cierre:** Piedecuesta → Vélez de extremo a extremo (plan §7) con las invariantes de la especificación §8.4 y el informe §8.5.
- **Especificación:** F7 y F8.

### F9 · Limpieza

- **Tareas:** la UI lee `EVRoutePlan`; borrar `planner.ts`, `annotateEnergy`, `legacy-adapter.ts` y el flag; reescribir `docs/calculo-consumo-energia.md`; definir el contrato `TripObservation` de calibración.
- **Cierre:** cobertura ≥ umbrales sobre `src/domain/ev`; PR `engine-v2 → main`.

## 5. Correspondencia con la especificación

| Plan del repo | Especificación v2 |
|---|---|
| F0 | — (correcciones sobre el código actual) |
| F1 | F1 |
| F2 | F3 |
| F3 | F2 (SOCEngine) |
| F4 | F5 |
| F5 | F2 (EnergyEngine) y F4 |
| F6 | — (limpieza de multiplicadores) |
| F7 | F6 |
| F8 | F7 y F8 |
| F9 | — (limpieza final) |

**Orden recomendado:** F1 → F2 → F3 → F4 → F7 → F5 → F6 → F8 → F9. F3, F4 y F7 corrigen casi todo lo que afecta la seguridad sin cambiar el consumo. F5 y F6 cambian los números y conviene hacerlas con el modo sombra ya activo.

## 6. Estado

| Fase | Estado | Commit |
|---|---|---|
| F0 | ✅ Hecha salvo la cassette (P1) | commits en `engine-v2` |
| F1 | En curso | — |
| F2 | Pendiente (decidir B6) | — |
| F3 | Pendiente | — |
| F4 | Pendiente | — |
| F5 | Pendiente | — |
| F6 | Pendiente | — |
| F7 | Pendiente | — |
| F8 | Pendiente | — |
| F9 | Pendiente | — |

## 7. Mensaje para abrir la sesión de una fase

> Trabaja en `w1andresv/voltia`, directo en la rama `engine-v2`. Lee `docs/arquitectura-ev/04-plan-de-trabajo.md` (sección de la fase F<N>), la sección correspondiente de `02-plan-arquitectura-modular.md` y de `prompt_ev_route_engine_v2.md`, y los ADR de `docs/adr/`. Implementa la fase con tests, corre `npm run typecheck && npm run lint && npm test` y haz un commit `F<N>: …` con la tabla de estado del plan de trabajo actualizada. Sube a `engine-v2`.
