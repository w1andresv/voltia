import { describe, expect, it } from "vitest";
import { DEFAULT_CURVE } from "./charging";
import { MODEL_PARAMETERS, type ModelParameters } from "./ev/core/params";
import { flexibleReserveSocPct } from "./ev/core/trip-config";
import { buildPlan } from "./planner";
import type { Charger, Place, RawRoute, RoutePlan, TripConditions, Vehicle } from "./types";

/**
 * Planificador v2: paradas que valen la pena (ADR-0018). Sesión mínima de 10 min,
 * tope estirado hasta 90 % solo si ahorra paradas y sugerencia de carga previa,
 * sin perder nunca la viabilidad ni el margen.
 */

const OVERHEAD = MODEL_PARAMETERS.charging.connectionOverheadMin.value;
const MIN_SESSION = MODEL_PARAMETERS.planner.minChargeSessionMin.value;
const CAP = MODEL_PARAMETERS.planner.maxChargeTargetSocPct.value;
const STRETCH = MODEL_PARAMETERS.planner.stretchChargeSocPct.value;
const TOL = 1e-6;

const vehicle: Vehicle = {
  id: "v1",
  brand: "Test",
  model: "EV",
  year: 2024,
  version: "base",
  batteryKwh: 60,
  rangeKm: 400,
  consumptionKwhPer100km: null,
  weightKg: 1800,
  motorKw: 150,
  acMaxKw: 11,
  dcMaxKw: 120,
  chargeCurve: DEFAULT_CURVE,
  connectors: ["ccs2", "type2"],
};

function conditions(overrides: Partial<TripConditions> = {}): TripConditions {
  return {
    passengers: 1,
    luggageKg: 0,
    initialSoc: 90,
    avgSpeedKmh: 90,
    ac: "normal",
    temperatureC: 20,
    drivingStyle: "normal",
    safetyMode: "low",
    customSafetyPct: 15,
    planningMode: "fastest",
    allowBelowSafety: false,
    regenLevel: "medium",
    ...overrides,
  };
}

/** Andino: sube a 2600 m, baja a 400 m y vuelve a subir. */
const hills = (km: number, d: number) => {
  const x = km / d;
  return x < 0.3
    ? 900 + (x / 0.3) * 1700
    : x < 0.6
      ? 2600 - ((x - 0.3) / 0.3) * 2200
      : 400 + ((x - 0.6) / 0.4) * 2200;
};

function route(distanceKm: number, hilly = false, stepKm = 5): RawRoute {
  const n = Math.round(distanceKm / stepKm) + 1;
  const samples = Array.from({ length: n }, (_, i) => {
    const km = Math.min(distanceKm, i * stepKm);
    return {
      km,
      lat: 4 + km / 111,
      lon: -74,
      elevM: hilly ? hills(km, distanceKm) : 0,
      slopePct: 0,
      speedKmh: hilly ? 70 : 90,
    };
  });
  return {
    id: "r1",
    label: "Ruta",
    geometry: samples.map((s) => ({ lat: s.lat, lon: s.lon })),
    samples,
    distanceKm,
    driveMinutes: (distanceKm / 90) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

const dc = (km: number, kw = 150): Charger => ({
  id: `dc${km}`,
  name: `DC km ${km}`,
  lat: 4 + km / 111,
  lon: -74,
  sockets: [{ connector: "ccs2", powerKw: kw, count: 2 }],
  source: "osm",
});
const ac = (km: number): Charger => ({
  id: `ac${km}`,
  name: `AC km ${km}`,
  lat: 4 + km / 111,
  lon: -74,
  sockets: [{ connector: "type2", powerKw: 22, count: 2 }],
  source: "osm",
});

const ORIGIN: Place = { label: "Origen", lat: 4, lon: -74 };
const dest = (km: number): Place => ({ label: "Destino", lat: 4 + km / 111, lon: -74 });

/**
 * Margen estricto (sin el margen flexible de ADR-0019): así las reglas de
 * ADR-0018 se prueban solas. El margen flexible tiene su bloque al final.
 */
const STRICT: ModelParameters = {
  ...MODEL_PARAMETERS,
  planner: {
    ...MODEL_PARAMETERS.planner,
    marginFlex: {
      ...MODEL_PARAMETERS.planner.marginFlex,
      value: { ...MODEL_PARAMETERS.planner.marginFlex.value, belowPct: 0 },
    },
  },
};

/** Parámetros sin las reglas de ADR-0018: el planificador v2 de antes, como control. */
const CONTROL: ModelParameters = {
  ...STRICT,
  planner: {
    ...STRICT.planner,
    minChargeSessionMin: { ...MODEL_PARAMETERS.planner.minChargeSessionMin, value: 0 },
    stretchChargeSocPct: { ...MODEL_PARAMETERS.planner.stretchChargeSocPct, value: CAP },
  },
};

function plan(
  d: number,
  chargers: Charger[],
  cond: Partial<TripConditions> = {},
  opts: { hilly?: boolean; params?: ModelParameters } = {},
): RoutePlan {
  return buildPlan({
    raw: route(d, opts.hilly),
    vehicle,
    conditions: conditions(cond),
    chargers,
    weather: null,
    origin: ORIGIN,
    destination: dest(d),
    engine: "v2",
    params: opts.params ?? STRICT,
  });
}

/** Minutos cargando, sin los de conexión. */
const charging = (s: RoutePlan["stops"][number]) => s.chargeMinutes - OVERHEAD;

describe("v2 · sesión mínima (ADR-0018)", () => {
  it("una parada necesaria de ~1 punto carga al menos 10 min en vez de 1 %", () => {
    // Sale con 85 %: a la AC del km 100 llega con ~56 % y le falta ~1 punto para la DC del km 260.
    const before = plan(300, [ac(100), dc(260)], { initialSoc: 85 }, { params: CONTROL });
    const first = before.stops[0]!;
    expect(first.charger.id).toBe("ac100");
    expect(first.departSoc - first.arriveSoc).toBeLessThan(3);

    const p = plan(300, [ac(100), dc(260)], { initialSoc: 85 });
    expect(p.feasible).toBe(true);
    const stop = p.stops[0]!;
    expect(stop.charger.id).toBe("ac100");
    expect(charging(stop)).toBeGreaterThanOrEqual(MIN_SESSION - 0.5);
    expect(stop.sessionExtraPct).toBeGreaterThan(0);
    expect(stop.fastChargeExtraPct).toBeUndefined();
  });

  it("en la última parada, la sesión mínima deja llegar con más que el margen y lo explica", () => {
    // Con 80 % y 300 km: una sola parada rápida a mitad de camino que necesita poco.
    const control = plan(300, [dc(150)], { initialSoc: 80 }, { params: CONTROL });
    const p = plan(300, [dc(150)], { initialSoc: 80 });
    const stop = p.stops[0]!;
    expect(control.stops[0]!.departSoc - control.stops[0]!.minDepartSoc).toBeLessThan(1.5);
    expect(charging(stop)).toBeGreaterThanOrEqual(MIN_SESSION - 0.5);
    expect(stop.sessionExtraPct).toBeGreaterThan(0);
    expect(stop.fastChargeExtraPct).toBeUndefined();
    expect(p.arrivalSoc).toBeGreaterThan(control.arrivalSoc);
    expect(p.arrivalSoc).toBeGreaterThanOrEqual(p.safetyPct - TOL);
  });

  it("si la sesión mínima pasaría del tope en ruta, sale con el tope", () => {
    // Llega a la estación con mucha batería: 10 min en DC de 150 kW lo llevarían sobre 80 %.
    const p = plan(420, [dc(60)], { initialSoc: 90 });
    for (const s of p.stops) expect(s.departSoc).toBeLessThanOrEqual(CAP + TOL);
  });
});

describe("v2 · tope estirado hasta 90 % solo para ahorrar una parada (ADR-0018)", () => {
  // DC de 50 kW cada 90 km, 500 km: sin la regla, la tercera parada carga ~2 puntos
  // porque la anterior ya salió al tope de 80 %.
  const chargers = [90, 180, 270, 360, 450].map((km) => dc(km, 50));
  const cond = { initialSoc: 55, safetyMode: "normal" as const };

  it("sin la regla, la parada anterior sale al tope y la siguiente carga poco", () => {
    const control = plan(500, chargers, cond, { params: CONTROL });
    const tiny = control.stops.findIndex((s) => s.departSoc - s.arriveSoc < 3);
    expect(tiny).toBeGreaterThan(0);
    expect(control.stops[tiny - 1]!.departSoc).toBeGreaterThanOrEqual(CAP - TOL);
  });

  it("con la regla, pasa del 80 % (sin llegar a 90 %) y el plan tiene una parada menos", () => {
    const withSession: ModelParameters = {
      ...CONTROL,
      planner: {
        ...CONTROL.planner,
        minChargeSessionMin: MODEL_PARAMETERS.planner.minChargeSessionMin,
      },
    };
    const sessionOnly = plan(500, chargers, cond, { params: withSession });
    const p = plan(500, chargers, cond);
    expect(p.feasible).toBe(true);
    expect(p.stops.length).toBeLessThan(sessionOnly.stops.length);
    const above = p.stops.filter((s) => s.departSoc > CAP + TOL);
    expect(above.length).toBeGreaterThan(0);
    for (const s of above) {
      expect(s.aboveRouteCap).toBe("fewer-stops");
      expect(s.departSoc).toBeLessThanOrEqual(STRETCH + TOL);
    }
    expect(p.minSoc).toBeGreaterThanOrEqual(p.safetyPct - 1e-3);
    expect(p.arrivalSoc).toBeGreaterThanOrEqual(p.safetyPct - 1e-3);
    // En "más rápida" el plan con menos paradas no tarda más.
    expect(p.totalMinutes).toBeLessThanOrEqual(sessionOnly.totalMinutes + 0.5);
  });
});

describe("v2 · sugerencia de carga antes de salir (ADR-0018)", () => {
  it("si la primera parada es marginal, dice con cuánto salir para no hacerla", () => {
    const p = plan(300, [ac(100), dc(260)], { initialSoc: 85 });
    expect(p.skipFirstStop).toBeDefined();
    const tip = p.skipFirstStop!;
    expect(tip.chargerName).toBe("AC km 100");
    expect(tip.startSoc).toBe(85 + tip.additionalPct);
    expect(tip.additionalPct).toBeLessThanOrEqual(5);

    const withTip = plan(300, [ac(100), dc(260)], { initialSoc: tip.startSoc });
    expect(withTip.feasible).toBe(true);
    expect(withTip.stops.length).toBeLessThan(p.stops.length);
    expect(withTip.stops.some((s) => s.charger.id === "ac100")).toBe(false);
  });

  it("no sugiere nada si la primera parada carga lo que vale una parada", () => {
    const p = plan(420, [dc(200, 50)], { initialSoc: 60 });
    expect(p.feasible).toBe(true);
    expect(p.skipFirstStop).toBeUndefined();
  });
});

describe("v2 · invariantes con las reglas nuevas (ADR-0018)", () => {
  const layouts: [string, (d: number) => Charger[]][] = [
    [
      "DC cada 70 km",
      (d) => Array.from({ length: Math.floor(d / 70) }, (_, i) => dc((i + 1) * 70)),
    ],
    [
      "DC 50 kW cada 90 km",
      (d) => Array.from({ length: Math.floor(d / 90) }, (_, i) => dc((i + 1) * 90, 50)),
    ],
    ["mixto AC/DC", () => [ac(60), dc(130, 60), ac(190), dc(250), dc(330, 50), ac(400), dc(470)]],
  ];
  const cases: [string, number, boolean, (d: number) => Charger[], Partial<TripConditions>][] = [];
  for (const hilly of [false, true]) {
    for (const d of [300, 500]) {
      for (const [name, mk] of layouts) {
        for (const initialSoc of [35, 60, 90]) {
          for (const planningMode of ["fastest", "fewer_stops", "safer"] as const) {
            cases.push([
              `${hilly ? "montaña" : "plano"} ${d} km · ${name} · ${initialSoc} % · ${planningMode}`,
              d,
              hilly,
              (km) => mk(km).filter((c) => (c.lat - 4) * 111 < km - 5),
              { initialSoc, planningMode, safetyMode: "normal" },
            ]);
          }
        }
      }
    }
  }

  it.each(cases)("%s", (_label, d, hilly, mk, cond) => {
    const control = plan(d, mk(d), cond, { hilly, params: CONTROL });
    const p = plan(d, mk(d), cond, { hilly });
    // Nunca se pierde la viabilidad por las reglas nuevas.
    if (control.feasible) expect(p.feasible).toBe(true);
    if (!p.feasible) return;
    expect(p.minSoc).toBeGreaterThanOrEqual(p.safetyPct - 1e-3);
    expect(p.arrivalSoc).toBeGreaterThanOrEqual(p.safetyPct - 1e-3);
    for (const s of p.stops) {
      // Ninguna parada pasa del tope estirado; por encima del tope normal, siempre con su motivo.
      expect(s.departSoc).toBeLessThanOrEqual(STRETCH + TOL);
      if (s.departSoc > CAP + TOL) expect(s.aboveRouteCap).toBeDefined();
      // Si para, carga al menos la sesión mínima, salvo que salga al tope.
      if (s.departSoc < CAP - 1) expect(charging(s)).toBeGreaterThanOrEqual(MIN_SESSION - 0.75);
    }
    const reason = p.stops.find((s) => s.aboveRouteCap)?.aboveRouteCap;
    if (reason) {
      // Mismo plan con el tope normal: pasar del 80 % se justifica con menos paradas, o porque sin eso no hay plan.
      const noStretch = plan(d, mk(d), cond, {
        hilly,
        params: {
          ...STRICT,
          planner: {
            ...STRICT.planner,
            stretchChargeSocPct: CONTROL.planner.stretchChargeSocPct,
          },
        },
      });
      if (reason === "fewer-stops") expect(p.stops.length).toBeLessThan(noStretch.stops.length);
      else expect(noStretch.feasible).toBe(false);
    }
  });
});

describe("margen de seguridad como única reserva (ADR-0017)", () => {
  it("con 'permitir bajar del margen', en ruta puede bajar hasta 5 %; al destino v1 llega con el margen y v2 con el margen flexible", () => {
    for (const engine of ["legacy", "v2"] as const) {
      const cond = conditions({ initialSoc: 70, safetyMode: "normal", allowBelowSafety: true });
      const p = buildPlan({
        raw: route(300, true),
        vehicle,
        conditions: cond,
        chargers: [dc(150)],
        weather: null,
        origin: ORIGIN,
        destination: dest(300),
        engine,
      });
      expect(p.feasible).toBe(true);
      const atDestination = engine === "v2" ? flexibleReserveSocPct(cond) : 15;
      expect(p.arrivalSoc).toBeGreaterThanOrEqual(atDestination - 1e-3);
      expect(p.minSoc).toBeGreaterThanOrEqual(5 - 1e-3);
    }
  });

  it("v1 llega al destino con el margen y v2 con el margen flexible, sin una 'llegada mínima' aparte", () => {
    for (const engine of ["legacy", "v2"] as const) {
      for (const safetyMode of ["low", "normal", "conservative"] as const) {
        const cond = conditions({ initialSoc: 90, safetyMode });
        const p = buildPlan({
          raw: route(400),
          vehicle,
          conditions: cond,
          chargers: [dc(120), dc(240), dc(330)],
          weather: null,
          origin: ORIGIN,
          destination: dest(400),
          engine,
        });
        expect(p.feasible).toBe(true);
        const atDestination = engine === "v2" ? flexibleReserveSocPct(cond) : p.safetyPct;
        expect(p.arrivalSoc).toBeGreaterThanOrEqual(atDestination - 1e-3);
      }
    }
  });
});

describe("v2 · margen flexible (ADR-0019)", () => {
  const FLEX = MODEL_PARAMETERS.planner.marginFlex.value.belowPct;
  const flexPlan = (d: number, chargers: Charger[], cond: Partial<TripConditions>, hilly = false) =>
    plan(d, chargers, cond, { hilly, params: MODEL_PARAMETERS });
  /** El mismo viaje con margen estricto y con margen flexible, para cada SOC de salida. */
  const sweep = (d: number, chargers: Charger[], cond: Partial<TripConditions>) =>
    Array.from({ length: 41 }, (_, i) => 60 + i).map((initialSoc) => ({
      initialSoc,
      strict: plan(d, chargers, { ...cond, initialSoc }),
      flex: flexPlan(d, chargers, { ...cond, initialSoc }),
    }));

  it("baja unos puntos del margen si así se ahorra una parada, y lo dice", () => {
    const saved = sweep(300, [dc(150)], { safetyMode: "normal" }).find(
      (c) => c.strict.stops.length === 1 && c.flex.stops.length === 0,
    );
    expect(saved).toBeDefined();
    const { strict, flex } = saved!;
    expect(flex.feasible).toBe(true);
    expect(flex.canArriveWithoutCharge).toBe(true);
    expect(flex.arrivalSoc).toBeLessThan(15);
    expect(flex.arrivalSoc).toBeGreaterThanOrEqual(15 - FLEX - 1e-3);
    expect(flex.totalMinutes).toBeLessThan(strict.totalMinutes);
    expect(flex.belowMargin).toMatchObject({ floorPct: 15 - FLEX });
    expect(flex.belowMargin!.points).toBeCloseTo(15 - flex.belowMargin!.lowestSoc, 6);
    expect(flex.belowMargin!.points).toBeLessThanOrEqual(FLEX + 1e-3);
  });

  it("no baja del margen para ahorrar solo unos minutos de carga", () => {
    // 500 km con una sola estación a mitad de camino: la parada es obligatoria, y
    // cargar 3 puntos más toma un par de minutos, menos que el costo de bajar del margen.
    // Saliendo con poco, los dos planes piden cargar antes de salir: bajar del margen
    // solo pediría unos puntos menos de esa carga, y tampoco vale la pena.
    for (const initialSoc of [55, 65, 75, 90, 95, 100]) {
      const cond = { initialSoc, safetyMode: "normal" as const };
      const strict = plan(500, [dc(250)], cond);
      const flex = flexPlan(500, [dc(250)], cond);
      expect(strict.feasible).toBe(true);
      expect(flex.stops.length).toBe(strict.stops.length);
      expect(flex.arrivalSoc).toBeGreaterThanOrEqual(15 - 1e-3);
      expect(flex.belowMargin).toBeUndefined();
    }
  });

  it("nunca baja del piso flexible: si ni así alcanza, para a cargar", () => {
    for (const { flex } of sweep(300, [dc(150)], { safetyMode: "normal" })) {
      expect(flex.feasible).toBe(true);
      expect(flex.minSoc).toBeGreaterThanOrEqual(15 - FLEX - 1e-3);
      expect(flex.arrivalSoc).toBeGreaterThanOrEqual(15 - FLEX - 1e-3);
    }
    // Saliendo con poco, sin cargar se llegaría bajo el piso: tiene que parar.
    const low = flexPlan(300, [dc(150)], { initialSoc: 60, safetyMode: "normal" });
    expect(low.stops.length).toBeGreaterThan(0);
  });

  it("en 'más segura' no baja del margen si hay un plan que lo respete", () => {
    for (const { strict, flex } of sweep(300, [dc(150)], {
      safetyMode: "normal",
      planningMode: "safer",
    })) {
      if (!strict.feasible) continue;
      expect(flex.minSoc).toBeGreaterThanOrEqual(15 - 1e-3);
      expect(flex.belowMargin).toBeUndefined();
    }
  });

  const layouts: [string, (d: number) => Charger[]][] = [
    [
      "DC cada 70 km",
      (d) => Array.from({ length: Math.floor(d / 70) }, (_, i) => dc((i + 1) * 70)),
    ],
    [
      "DC 50 kW cada 90 km",
      (d) => Array.from({ length: Math.floor(d / 90) }, (_, i) => dc((i + 1) * 90, 50)),
    ],
    ["mixto AC/DC", () => [ac(60), dc(130, 60), ac(190), dc(250), dc(330, 50), ac(400), dc(470)]],
  ];
  const cases: [string, number, boolean, Charger[], Partial<TripConditions>][] = [];
  for (const hilly of [false, true]) {
    for (const d of [300, 500]) {
      for (const [name, mk] of layouts) {
        for (const initialSoc of [35, 60, 90]) {
          for (const planningMode of ["fastest", "fewer_stops", "safer"] as const) {
            cases.push([
              `${hilly ? "montaña" : "plano"} ${d} km · ${name} · ${initialSoc} % · ${planningMode}`,
              d,
              hilly,
              mk(d).filter((c) => (c.lat - 4) * 111 < d - 5),
              { initialSoc, planningMode, safetyMode: "normal" },
            ]);
          }
        }
      }
    }
  }

  it.each(cases)("%s", (_label, d, hilly, chargers, cond) => {
    const strict = plan(d, chargers, cond, { hilly });
    const flex = flexPlan(d, chargers, cond, hilly);
    // Lo que era viable lo sigue siendo, y nunca baja del piso flexible.
    if (strict.feasible) expect(flex.feasible).toBe(true);
    if (!flex.feasible) return;
    expect(flex.minSoc).toBeGreaterThanOrEqual(15 - FLEX - 1e-3);
    expect(flex.arrivalSoc).toBeGreaterThanOrEqual(15 - FLEX - 1e-3);
    // Si baja del margen, lo dice.
    const lowest = Math.min(flex.minSoc, flex.arrivalSoc);
    if (lowest < 15 - 0.05) expect(flex.belowMargin).toBeDefined();
    else expect(flex.belowMargin).toBeUndefined();
    if (!strict.feasible || strict.departureCharge || flex.departureCharge) return;
    // Bajar del margen solo se hace si mejora el plan según la estrategia.
    if (cond.planningMode === "fastest") {
      expect(flex.totalMinutes).toBeLessThanOrEqual(strict.totalMinutes + 0.5);
    } else if (cond.planningMode === "fewer_stops") {
      expect(flex.stops.length).toBeLessThanOrEqual(strict.stops.length);
    } else {
      expect(flex.minSoc).toBeGreaterThanOrEqual(Math.min(strict.minSoc, 15) - 1e-3);
    }
  });
});
