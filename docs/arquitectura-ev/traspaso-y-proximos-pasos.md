# Traspaso: motor de rutas EV de Voltia

Resumen para retomar el trabajo en otra sesión (por ejemplo, una con el repositorio `w1andresv/voltia` conectado) sin perder contexto. Adjunta este archivo junto con los demás `.md` al empezar.

## 1. Qué se hizo

1. **Revisión del prompt original** "Arquitectura definitiva — EV Route Planning Engine" → `feedback-prompt-original.md`.
2. **Prompt corregido** → `prompt_ev_route_engine_v2.md` (especificación genérica: engines, física, SOC, planificador, viabilidad, caso de prueba).
3. **Revisión del repo contra ese prompt** (commit `d7b3651` de `main`) → `01-feedback-codigo-vs-plan.md`. Errores C1–C8 verificados ejecutando el código.
4. **Plan reescrito para el repo** → `02-plan-arquitectura-modular.md` (capas, puertos, snapshot, engines, migración por fases F0–F9, caso Piedecuesta → Vélez con el MG S5 EV Deluxe).

## 2. Estado del branch

> **Actualización:** los seis documentos ya están en el repo, en `docs/arquitectura-ev/`, en el branch
> `claude/practical-mccarthy-1w48ow` ([PR #14](https://github.com/w1andresv/voltia/pull/14)). En esa
> sesión `npm ci` sí funcionó, así que F0 se puede hacer con vitest. Lo que sigue en esta sección
> describe la sesión anterior y ya no hace falta repetirlo.

- Branch local `refactor/ev-route-engine-arquitectura` con **1 commit** (`0847f68`) que agrega `docs/arquitectura-ev/01-feedback-codigo-vs-plan.md` y `docs/arquitectura-ev/02-plan-arquitectura-modular.md`. Solo documentación.
- **No se subió a GitHub:** la sesión donde se trabajó no tenía autorizado el repositorio (el push devolvía 403). El repositorio se autoriza al **crear** una sesión, no después.
- En esa sesión tampoco se pudo correr `npm ci` (403 del registro de npm), así que los hallazgos se verificaron ejecutando `src/domain` directamente con Node (sección 5).

### Recrear el branch (sin el `.patch`)

Desde tu copia local del repo, con los dos archivos descargados:

```bash
git checkout main && git pull
git checkout -b refactor/ev-route-engine-arquitectura
mkdir -p docs/arquitectura-ev
cp ~/Descargas/01-feedback-codigo-vs-plan.md ~/Descargas/02-plan-arquitectura-modular.md docs/arquitectura-ev/
git add docs/arquitectura-ev
git commit -m "docs: revisión del motor de rutas EV y plan de arquitectura modular"
git push -u origin refactor/ev-route-engine-arquitectura
```

Con el `.patch`: `git am voltia-arquitectura-ev.patch` en lugar de los pasos `mkdir`, `cp`, `add` y `commit`.

## 3. Datos clave para no volver a buscarlos

| Dato | Valor | Dónde |
|---|---|---|
| Vehículo del caso de prueba | MG S5 EV Deluxe 2027 (`mg-s5-ev-deluxe`) | `seeds/0001_vehicle_catalog.sql` |
| Batería | 47,1 kWh útiles (`batteryKwh`), 49 kWh brutos | seed, con fuentes en comentarios |
| Peso | 1672 kg (Deluxe); 1627 kg (Comfort, vehículo por defecto de la app) | seed, `src/domain/vehicles.ts` |
| Carga | AC 7 kW, DC 120 kW; CCS2 + Tipo 2 | seed |
| Curva de carga | `DEFAULT_CURVE` genérica ("no verificable", según el seed) | `src/domain/charging.ts` |
| Ruta | Mapbox perfil `driving`, ~212 km casi toda por vías principales | comentario en `routing.mapbox.ts:7-11` |
| Ocupantes 150 kg | conductor (75, siempre incluido) + `passengers: 1` (75) | `src/domain/types.ts` (`extraWeightKg`) |
| Masa total | 1672 + 150 + 30 = 1852 kg | calculado |
| Reserva 10 % / 10 % | `safetyMode: "low"`, `arrivalSoc: 10` | `TripConditions` |

## 4. Próximos pasos (fase F0 del plan)

1. Tests de regresión para C1, C2, C3, C5 y C8 (casos de la sección 5).
2. Correcciones sobre el código actual:
   - **C1:** comprobar el piso de SOC en todos los puntos del tramo, no solo en la llegada (`planner.ts:197`, `:214`, `:541`).
   - **C2:** descontar la energía de los desvíos en la curva de SOC, la llegada, `energyKwh` y `avgKwhPer100km` (`planner.ts:561-577`, `:857`, `:860`).
   - **C3:** `P(soc) = min(dcMaxKw × factor(soc), potencia del cargador)` (`charging.ts:49`).
   - **C5:** búsqueda binaria de la carga previa sin `floor(100 − actual)` (`planner.ts:698-702`).
   - **C8:** una sola función para los pisos de SOC que usen el panel y el planificador (`energy.ts:443-447` frente a `planner.ts:181-189`). Decidir si `minSocRecommended` entra al piso.
3. `scripts/record-snapshot.mjs` (a partir de `diagnose-route.mjs`) para grabar el caso Piedecuesta → Vélez como fixture sin red.
4. Reglas de ESLint de dependencias para `src/domain` (sección 2.2 del plan).

Criterio de cierre: los 5 tests pasan y el CI (`typecheck`, `lint`, `test:coverage`, `build`) queda verde.

### Mensaje sugerido para la sesión nueva

> Trabaja en `w1andresv/voltia`. Adjunto la revisión y el plan de arquitectura del motor de rutas EV. Crea el branch `refactor/ev-route-engine-arquitectura` con `docs/arquitectura-ev/01-feedback-codigo-vs-plan.md` y `02-plan-arquitectura-modular.md`, súbelo, y luego ejecuta la fase F0 del plan: tests de regresión y correcciones de C1, C2, C3, C5 y C8, el script de snapshot y las reglas de ESLint. Corre `npm run typecheck`, `npm run lint` y `npm test` antes de cada commit.

## 5. Reproducción de los hallazgos sin npm

Si `npm ci` no funciona, el código de dominio se puede ejecutar con Node 22 (`--experimental-strip-types`) y un resolvedor que traduce `@/` a `src/`. Guarda los tres archivos en una carpeta fuera del repo (por ejemplo, `/tmp/probe`) y ejecuta **desde la raíz del repo**:

```bash
node --experimental-strip-types --no-warnings --import /tmp/probe/register.mjs /tmp/probe/probes.ts
```

Salida esperada con el código de `d7b3651`:

```text
C1 { feasible: true, stops: 0, minSoc: 3.03, arrivalSoc: 10.63, reserva: 10 }
C2 { detourKm: 19.93, departSoc: 55.57, socCurvaTrasParada: 60.23 }
C3 { codigoMin: 42.63, esperadoMin: 33.91 }
C5 20 { feasible: true, cargaPrevia: 32, imposible: false }
C5 20.5 { feasible: false, cargaPrevia: undefined, imposible: true }
C6 60 % → 1.49 kWh
C6 85 % → 1.63 kWh
C6 95 % → 2.04 kWh
D1 efficient 15.82 kWh/100 km
D1 normal 16.55 kWh/100 km
D1 sport 17.73 kWh/100 km
```

### `register.mjs`

```js
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
```

### `loader.mjs`

```js
// Resuelve "@/…" a ./src/… y agrega la extensión .ts a imports relativos sin extensión.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.join(process.cwd(), "src");
const isFile = (p) => existsSync(p) && statSync(p).isFile();

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file:")) {
    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec);
    for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
      if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(spec, context);
}
```

### `probes.ts`

```ts
import { buildPlan } from "@/domain/planner";
import { annotateEnergy, energyBetween, segmentEnergyBreakdown } from "@/domain/energy";
import { chargeTimeMinutes, DEFAULT_CURVE, lerpFactor } from "@/domain/charging";
import { VEHICLE_CATALOG } from "@/domain/vehicles";
import type { Charger, RawRoute, TripConditions, Vehicle } from "@/domain/types";

// MG S5 EV Deluxe (catálogo: 47,1 kWh útiles, 1672 kg)
const mg: Vehicle = { ...VEHICLE_CATALOG[0]!, id: "mg-s5-ev-deluxe", version: "Deluxe", weightKg: 1672 };
const cond = (o: Partial<TripConditions> = {}): TripConditions => ({
  passengers: 1, luggageKg: 30, initialSoc: 80, arrivalSoc: 10, avgSpeedKmh: null, ac: "normal",
  temperatureC: 25, drivingStyle: "normal", safetyMode: "low", customSafetyPct: 10,
  planningMode: "fastest", allowBelowSafety: false, regenLevel: "medium", ...o,
});
function route(profile: (km: number) => number, distanceKm: number, stepKm = 1, speed = 60): RawRoute {
  const n = Math.round(distanceKm / stepKm) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * stepKm);
    return { km, lat: 4 + km / 111, lon: -74, elevM: profile(km), slopePct: 0, speedKmh: speed };
  });
  return { id: "r", label: "r", geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })), samples,
    distanceKm, driveMinutes: (distanceKm / speed) * 60, elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 } };
}
const charger = (km: number, lonOff = 0): Charger => ({
  id: `c${km}`, name: `C${km}`, lat: 4 + km / 111, lon: -74 + lonOff,
  sockets: [{ connector: "ccs2", powerKw: 60, count: 1 }], source: "osm" });
const O = { label: "O", lat: 4, lon: -74 };
const D = (km: number) => ({ label: "D", lat: 4 + km / 111, lon: -74 });
const r2 = (n: number) => Math.round(n * 100) / 100;

// C1 — montaña: viable sin paradas aunque el SOC baja de la reserva en la cima
{
  const prof = (km: number) => (km <= 40 ? 500 + (1500 * km) / 40 : 2000 - (1500 * (km - 40)) / 20);
  const p = buildPlan({ raw: route(prof, 60), vehicle: mg, conditions: cond({ initialSoc: 31, regenLevel: "high" }),
    chargers: [], weather: null, origin: O, destination: D(60) });
  console.log("C1", { feasible: p.feasible, stops: p.stops.length, minSoc: r2(p.minSoc), arrivalSoc: r2(p.arrivalSoc), reserva: p.safetyPct });
}

// C2 — el SOC de la curva no descuenta el desvío al cargador
{
  const p = buildPlan({ raw: route(() => 1000, 300), vehicle: mg, conditions: cond(),
    chargers: [charger(150, 0.09)], weather: null, origin: O, destination: D(300) });
  const st = p.stops[0]!;
  const after = p.samples.find((s) => s.km >= st.kmAlongRoute + 0.01)!;
  console.log("C2", { detourKm: r2(st.detourKm), departSoc: r2(st.departSoc), socCurvaTrasParada: r2(after.soc) });
}

// C3 — tiempo de carga 20→80 % en cargador de 50 kW con auto de 120 kW
{
  const actual = chargeTimeMinutes(47.1, 20, 80, 120, 50, DEFAULT_CURVE);
  let h = 0;
  for (let i = 0; i < 600; i++) {
    const soc = 20 + (60 * (i + 0.5)) / 600;
    h += (47.1 * 0.6) / 600 / Math.min(50, 120 * lerpFactor(DEFAULT_CURVE, soc));
  }
  console.log("C3", { codigoMin: r2(actual), esperadoMin: r2(h * 60) });
}

// C5 — SOC inicial con decimales
for (const soc of [20, 20.5]) {
  const p = buildPlan({ raw: route(() => 1000, 300), vehicle: mg, conditions: cond({ initialSoc: soc }),
    chargers: [charger(160)], weather: null, origin: O, destination: D(300) });
  console.log("C5", soc, { feasible: p.feasible, cargaPrevia: p.departureCharge?.additionalPct, imposible: p.firstChargerUnreachable ?? false });
}

// C6 — la energía de una bajada depende del SOC inicial
for (const soc of [60, 85, 95]) {
  const s = annotateEnergy(route((km) => 2400 - 20 * km, 70).samples, { vehicle: mg, conditions: cond(), weather: null }, soc);
  console.log("C6", soc, "% →", r2(energyBetween(s, 0, s.length - 1)), "kWh");
}

// D1 — multiplicador de estilo a igual velocidad
for (const st of ["efficient", "normal", "sport"] as const) {
  const e = segmentEnergyBreakdown(100, 0, 90, { vehicle: mg, conditions: cond({ drivingStyle: st }), weather: null }, 50);
  console.log("D1", st, r2(e.netKwh), "kWh/100 km");
}
```

Estos casos son la base de los tests de regresión de F0. Con vitest disponible, conviene pasarlos a `src/domain/*.test.ts` con los valores esperados **después** de cada corrección.
