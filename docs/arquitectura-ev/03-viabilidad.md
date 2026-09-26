# Viabilidad de implementar el motor de rutas EV v2

Evaluación del código de `main` (`d7b3651`, el mismo commit que se revisó en
[`01-feedback-codigo-vs-plan.md`](./01-feedback-codigo-vs-plan.md)) frente al
[`02-plan-arquitectura-modular.md`](./02-plan-arquitectura-modular.md) y la
[`prompt_ev_route_engine_v2.md`](./prompt_ev_route_engine_v2.md). Rama de trabajo: `engine-v2`.

## Veredicto

**Es viable si se hace por fases, como propone el plan.** Una reescritura de una sola vez no lo es.

- **F0–F4 (correcciones, puertos, snapshot, SOC y compatibilidad):** viabilidad **alta**. Son cambios locales sobre un dominio que ya es puro y tiene 317 tests. No hay bloqueos técnicos.
- **F5–F6 (física sin multiplicadores y perfil de velocidad):** viabilidad **media**. El código es fácil. Lo difícil son los **datos**: no hay Cd, área frontal ni Crr con fuente para ningún vehículo del catálogo, y no se sabe cuánto cubren en Colombia los límites de velocidad de Mapbox. Sin datos, el modelo "sin multiplicadores" termina usando valores `estimated` y no queda claro que sea más exacto que el actual.
- **F7 (programación dinámica):** viabilidad **media-alta**. El algoritmo es estándar. El riesgo es que tarde más de 150 ms en el navegador, porque el store recalcula en el cliente cada vez que el usuario cambia algo.
- **F8–F9 (pasada 2, snapshot guardado, limpieza):** viabilidad **media**. Suben las llamadas a Mapbox y a elevación, y aparece un esquema nuevo para los viajes guardados.

Lo que más valor da con menos riesgo es **F0 → F3 → F4 → F7** (el orden alternativo del plan). Corrige los errores que afectan la seguridad del usuario (C1, C2, C4) sin cambiar el modelo de consumo.

---

## 1. Estado real del repo (verificado hoy)

| Chequeo | Resultado |
|---|---|
| `npm ci` | Funciona en esta sesión. En la sesión de la revisión había fallado. |
| `npm run typecheck` | ✅ |
| `npx vitest run` | ✅ 317 tests en 31 archivos (la revisión decía "más de 170"). |
| `npm run test:scripts` | ✅ 4 de 4 |
| `npm run lint` | ❌ **1 error ya presente en `main`**: `prefer-const` en `src/domain/stations/text.ts:27`, más 3 warnings. Si CI corre lint, `main` está en rojo desde antes de empezar. |
| CI (`.github/workflows/ci.yml`) | Solo se ejecuta en `push` a `main` y en PR hacia `main`. **Los push a `engine-v2` no disparan CI** si no hay una PR abierta hacia `main`. |
| Cobertura | Umbral 80/80/80/70 sobre `src/domain/**`. `src/domain/ev` quedaría incluido automáticamente. |
| Token de Mapbox en esta sesión | No hay (`.env` y `.env.local` no están en el checkout). |

## 2. Hallazgos C1–C8: confirmación contra el código

No se volvieron a ejecutar las pruebas del traspaso: en esta sesión no se permitió correr código tomado de los documentos subidos. En su lugar se **leyó cada línea citada**. Todos los hallazgos se sostienen:

| # | ¿Se confirma? | Evidencia en el código | Tamaño del arreglo |
|---|---|---|---|
| C1 | ✅ | `planner.ts:197-199`, `:214-215` y `:541-542` comparan solo el SOC de llegada (`socAfter(...) >= arrivalTarget`). Ningún punto revisa `min(soc)` del tramo. | M. Hay que cambiar `canReachDestFrom`, `arriveAt` y la salida temprana para que usen el mínimo del intervalo. Cambia resultados en montaña, así que algunos tests existentes pueden necesitar valores nuevos. |
| C2 | ✅ | `applyStopsToSamples` (`:561-577`) arma el SOC con `cumulativeKwh` de la vía y `energyAddedKwh`. `detourKwh` no entra en ningún lado. | S. Restar la energía del desvío a partir de cada parada y sumarla a `energyKwh` y `avgKwhPer100km`. |
| C3 | ✅ | `charging.ts:49`: `Math.min(vehiclePeakKw, chargerKw) * lerpFactor(...)`. | XS. Una línea, más tests. |
| C4 | ✅ | `verifiedAdapter` (`charging.ts:92-101`) no lee `vehicle.adapters`, aunque el campo existe (`schemas.ts:45`). `currentFromStandard("gb_t")` devuelve siempre `"DC"` (`connectors.ts:36`). `toSockets` (`to-charger.ts:9-21`) descarta la corriente. | M. Toca el esquema del vehículo, el editor de vehículo y el modelo de estaciones. Es F4. |
| C5 | ✅ | `planner.ts:698-701`. Con 20,5 %: `maxAdd = 79`, `20,5 + 79 = 99,5 < 100`, así que pide `ceil(79,5) = 80` → sale con 100,5 % → `impossible`. | XS |
| C6 | ✅ | `effectiveRegen(conditions, socPct)` (`energy.ts:139-144`) está dentro del modelo de energía. | L. Es F3: separar energía de SOC. |
| C7 | ✅, con un matiz | `merge.ts:58-63` asigna 50/22/150 kW cuando nadie reporta potencia. El filtro `confirmed` de `to-charger.ts:13` **no** lo evita: `confirmed` significa "lo vio una fuente distinta del catálogo" (`merge.ts:80`), no "potencia medida". | S–M. Agregar `powerOrigin` al modelo y llevarlo hasta el planificador. |
| C8 | ✅, **en tres lugares, no dos** | `batteryBudget` (`energy.ts:443-447`) y también `vehicle-bar.tsx:14` usan `max(safety, minSocRecommended, arrivalSoc)`. El planificador (`planner.ts:181-189`) ignora `minSocRecommended`. | S, pero requiere tu decisión (ver sección 5). |

## 3. Supuestos del plan que se cumplen

- **El dominio es puro:** ningún archivo de `src/domain` importa infraestructura, `next` ni React. Las reglas de ESLint de la sección 2.2 del plan se pueden activar sin romper nada del dominio actual.
- **El recálculo en el cliente existe:** `rankedPlansFor` (`lib/store.ts:136-157`) ejecuta `buildPlan` y `rankPlans` sobre `geo`. `computePlan(snapshot, …)` sería su reemplazo directo.
- **`GeoBundle` ya es casi un snapshot:** tiene `stationsVersion`. Faltan la geometría completa, la elevación cruda y las anotaciones.
- **El patrón de puertos ya está en el repo:** `StationSource` en `infrastructure/stations/sources/types.ts`.
- **Viajes guardados:** `trips.ts` guarda `PlanRequest` y un resumen, no el plan (`trips.ts:11`, `:42`). Por eso hoy un viaje compartido se recalcula con datos vivos (A7), como dice la revisión.

## 4. Alcance del cambio en la UI

Tipos que el plan reemplaza (`RoutePlan`, `RouteSample`, `GeoBundle`) y quién los usa fuera de `domain`:

```
components/map/leaflet-map.tsx, map-types.ts
components/planner/consumption-chart.tsx, elevation-chart.tsx, export-gps-button.tsx,
  itinerary.tsx, route-compare.tsx, soc-chart.tsx, stats.tsx, trip-panel.tsx
components/trips/save-trip-button.tsx, shared-trip-view.tsx
lib/store.ts, server/actions/plan.ts
```

Son 14 archivos y ~3.600 líneas solo en `components/planner`. Por eso el `legacy-adapter.ts` del plan (`EVRoutePlan → RoutePlan`) **es obligatorio**: sin él, F1–F7 obligarían a tocar toda la UI en cada fase.

## 5. Bloqueos y decisiones que dependen de ti

| # | Tema | Por qué bloquea | Qué necesito |
|---|---|---|---|
| B1 | **Token de Mapbox para grabar el snapshot de Piedecuesta → Vélez** (F0, `record-snapshot.mjs`) | Esta sesión no tiene token. Sin el snapshot, el test de extremo a extremo y el modo sombra no tienen fixture. | Agregar `MAPBOX_ACCESS_TOKEN` como secreto del entorno, o que corras el script en tu máquina y subas el JSON. Mientras tanto, F0 puede avanzar con perfiles sintéticos. |
| B2 | **C8: ¿`minSocRecommended` entra al piso?** | Define el piso de todo el planificador. | Sí / no. El plan propone "sí": para el MG S5 el piso sería 15 % aunque el margen sea "bajo". |
| B3 | **Coeficientes físicos (Cd, A, Crr)** por vehículo | Sin ellos, F5–F6 reemplazan multiplicadores por valores `estimated`. | Fichas técnicas, o aceptar la tabla por `bodyType` marcada como estimada. |
| B4 | **Datos del caso de prueba**: SOC inicial y adaptadores del usuario (`[COMPLETAR]` en el plan §7.1) | El test de extremo a extremo necesita valores fijos. | Confirmar SOC 80 % y "sin adaptadores" (o los que lleves). |
| B5 | **CI en `engine-v2`** | Los push a esta rama no corren CI. | Abrir una PR en borrador `engine-v2 → main`, o agregar la rama al workflow. |
| B6 | **Presupuesto de elevación** (F2) | Una malla de 100 m con Open-Meteo son ~22 consultas por ruta y hasta ~88 por plan. | Elegir entre teselas de terreno de Mapbox con caché (preferida) o una malla adaptativa. |

## 6. Riesgos por fase

| Fase | Riesgo principal | Probabilidad | Mitigación |
|---|---|---|---|
| F0 | El arreglo de C1 cambia paradas en rutas de montaña y rompe tests actuales con valores fijos | Alta, pero es el efecto buscado | Actualizar esos valores con justificación en el commit |
| F1 | Diferencias pequeñas al envolver el código actual en puertos | Baja | Test de igualdad contra el fixture |
| F2 | Migración del `GeoBundle` persistido en el store del cliente (`lib/store.ts` tiene versiones) | Media | Migración versionada, como ya se hace con `regenPct` |
| F3 | Separar energía de SOC cambia la energía en bajadas con batería llena (C6) | Media | Modo sombra y diferencias documentadas |
| F4 | El editor de vehículo cambia (casillas de adaptadores); vehículos guardados sin `adapters` | Baja | Campo opcional; por defecto, ninguno |
| F5–F6 | Los números de consumo que ve el usuario cambian sin datos para calibrar | **Alta** | Modo sombra, ADR, y no borrar multiplicadores hasta tener calibración |
| F7 | Más de 150 ms por ruta en el navegador | Media | Tabla de tramos con malla gruesa; si no alcanza, recalcular en el servidor |
| F8 | Más llamadas a Mapbox por la pasada 2 (costo y cuota) | Media | Verificar solo al guardar o compartir, no en cada cambio |

## 7. Esfuerzo estimado

Estimación gruesa, en PRs, para una persona con agente. Hay que confirmarla al cerrar F0.

| Fase | PRs | Tamaño |
|---|---|---|
| F0 | 2–3 | S |
| F1 | 2 | M |
| F2 | 2–3 | M–L |
| F3 | 1–2 | M |
| F4 | 2 | M |
| F5 | 3 | L |
| F6 | 1 | S |
| F7 | 2 | L |
| F8 | 2–3 | L |
| F9 | 1–2 | M |

## 8. Otras diferencias entre la especificación y el código

- La especificación v2 (§2.7) prohíbe `Math.round` y `toFixed` en el dominio. Hoy hay 7 usos, en `planner.ts`, `types.ts`, `geo.ts`, `road-hierarchy.ts`, `conditions-advice.ts` y `user/fingerprint.ts`. Aplica solo a `src/domain/ev`. El código viejo se va con F9.
- La especificación deja el **viento** fuera de alcance en v1, pero el código ya lo modela bien. El plan (§0) lo conserva. Hay que mantener esa decisión y registrarla en un ADR, porque la especificación pide ADR para todo lo que esté fuera de alcance.
- La especificación pide un ADR en `docs/adr/` para cualquier funcionalidad fuera de alcance. Esa carpeta no existe todavía.

## 9. Próximo paso propuesto

Empezar F0 en `engine-v2`:

1. Arreglar el error de lint que ya viene de `main` (`text.ts:27`).
2. Tests de regresión y arreglos de C3 y C5 (XS), C2 (S), C1 (M) y C8 (cuando decidas B2).
3. Reglas de ESLint para `src/domain`.
4. `scripts/record-snapshot.mjs`. El fixture queda para cuando haya token (B1).

---

## 10. Estado de F0 (rama `engine-v2`)

| Punto | Estado | Commit |
|---|---|---|
| Error de lint heredado de `main` (`text.ts:27`) | ✅ | `cabfaac` |
| Cd·A y Crr por carrocería (MVP), con valores explícitos en cada vehículo del catálogo | ✅ | `f0287aa`, `67580e7` |
| Falso "no viable" por redondeo al llegar justo al objetivo | ✅ (apareció al cambiar Cd·A) | `96f180c` |
| C8: la reserva incluye `minSocRecommended` (decisión B2: sí; si el usuario lo edita, vale su valor) | ✅ | `54e71fb` |
| C3: potencia de carga = min(auto × curva, cargador) | ✅ | `0df0237` |
| C5: carga previa con SOC inicial decimal | ✅ | `02a059b` |
| C2: la energía del desvío se descuenta de la curva, la llegada, `energyKwh` y el promedio | ✅ | `bbbd181` |
| C1: piso de SOC en todo el tramo, no solo al llegar | ✅ | `df7c7b3` |
| Regla de ESLint de dependencias para `src/domain` | ✅ | `e908421` |
| Grabación y reproducción del fixture Piedecuesta → Vélez (`npm run snapshot:record`, `src/test-support/`) | ✅ Herramientas listas y probadas sin red. ⏸ Falta grabar la cassette: la red de este entorno bloquea Mapbox y Open-Meteo (ver `04-plan-de-trabajo.md`, P1) | `4c25cfe` |
| Cobertura de ramas ≥ 70 % | ✅ 76,3 % (venía en 66,1 % desde `main`) con tests de los módulos de estaciones | `c6c50fa` |
| CI en `engine-v2` y en sus PR | ✅ Verde | `c6c50fa` |
| Hook de inicio de sesión para sesiones web | ✅ | `3054cf5` |

Cada corrección trae tests que fallan con el código anterior y pasan con el nuevo.
