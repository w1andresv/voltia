import { describe, expect, it } from "vitest";
import type { RawRoute, TripConditions } from "@/domain/types";
import { catalogVehicle } from "@/test-support/scenarios";
import { buildPlan } from "../planner";
import { MODEL_PARAMETERS } from "./core/params";
import { detourEnergyV2, energyProfileForRoute, energyProfileForRouteCached } from "./energy-v2";

const KM_PER_DEG = 111.195;
function hillRoute(km: number): RawRoute {
  const at = (d: number) => ({ lat: 7 + d / KM_PER_DEG, lon: -73 });
  const samples = Array.from({ length: km + 1 }, (_, i) => ({
    km: i,
    ...at(i),
    elevM: 1000 + 400 * Math.sin((Math.PI * i) / km),
    slopePct: 0,
    speedKmh: 70,
  }));
  return {
    id: "r",
    label: "r",
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: km,
    driveMinutes: (km / 70) * 60,
    elevation: { gainM: 400, lossM: 400, minM: 1000, maxM: 1400 },
  };
}

const conditions: TripConditions = {
  passengers: 1,
  luggageKg: 0,
  initialSoc: 80,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: 22,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenLevel: "medium",
};
const vehicle = catalogVehicle("mg-s5-ev-deluxe");

describe("energyProfileForRoute", () => {
  it("con el perfil denso cuenta las subidas y bajadas cortas entre muestras", () => {
    // Muestras cada 2 km, todas a 1000 m: entre ellas, lomas de 30 m que solo ve el perfil denso.
    const flat = hillRoute(20);
    const samples = flat.samples.filter((s) => s.km % 2 === 0).map((s) => ({ ...s, elevM: 1000 }));
    const route: RawRoute = {
      ...flat,
      samples,
      elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1000 },
    };
    const hills = {
      stepKm: 0.1,
      elevM: Array.from({ length: 201 }, (_, i) => 1000 + 30 * Math.sin((Math.PI * i) / 10) ** 2),
    };
    const coarse = energyProfileForRoute(route, vehicle, conditions, null);
    const dense = energyProfileForRoute(
      { ...route, elevationProfile: hills },
      vehicle,
      conditions,
      null,
    );
    // Subir cuesta más de lo que devuelve bajar: más energía neta y más regeneración.
    expect(dense.totals.netEnergyKwh).toBeGreaterThan(coarse.totals.netEnergyKwh);
    expect(dense.totals.energyRegeneratedKwh).toBeGreaterThan(coarse.totals.energyRegeneratedKwh);
  });

  it("perfil por muestra, duración del perfil de velocidad y supuestos", () => {
    const out = energyProfileForRoute(hillRoute(40), vehicle, conditions, null);
    expect(out.samples).toHaveLength(41);
    expect(out.samples[40]!.cumulativeKwh).toBeCloseTo(out.totals.netEnergyKwh, 9);
    expect(out.totals.energyRegeneratedKwh).toBeGreaterThan(0);
    expect(out.speed.points[0]!.speedKmh).toBe(0);
    // Arrancar y parar alarga un poco frente a 70 km/h constantes.
    expect(out.durationMinutes).toBeGreaterThan((40 / 70) * 60);
    expect(out.durationDeviationPct).toBeGreaterThan(0);
    expect(out.assumptions).toContain("drivetrainEfficiency");
    expect(out.assumptions).not.toContain("dragAreaM2"); // el catálogo trae Cd·A
  });

  it("sport gasta más que eficiente en la misma ruta (por velocidad y aceleración, no por un multiplicador)", () => {
    const eff = energyProfileForRoute(
      hillRoute(40),
      vehicle,
      { ...conditions, drivingStyle: "efficient" },
      null,
    );
    const sport = energyProfileForRoute(
      hillRoute(40),
      vehicle,
      { ...conditions, drivingStyle: "sport" },
      null,
    );
    expect(sport.totals.netEnergyKwh).toBeGreaterThan(eff.totals.netEnergyKwh);
    expect(sport.durationMinutes).toBeLessThan(eff.durationMinutes);
  });

  it("con consumo manual, en llano a 70 km/h da el consumo del usuario", () => {
    const flat = hillRoute(100);
    flat.samples.forEach((s) => (s.elevM = 1000));
    const manual = { ...vehicle, consumptionManual: true, consumptionKwhPer100km: 18 };
    const out = energyProfileForRoute(
      flat,
      manual,
      { ...conditions, ac: "off", avgSpeedKmh: 70 },
      null,
    );
    // Arrancar y parar suma algo sobre los 18 kWh/100 km de crucero.
    expect(out.totals.netEnergyKwh).toBeGreaterThan(17.5);
    expect(out.totals.netEnergyKwh).toBeLessThan(19);
    expect(out.params.dragAreaM2.source).toBe("calculated");
  });

  it("una ruta de dos muestras muy corta no falla", () => {
    const tiny = hillRoute(1);
    tiny.samples = [tiny.samples[0]!, { ...tiny.samples[1]!, km: 0.05 }];
    tiny.distanceKm = 0.05;
    tiny.geometry = tiny.samples.map(({ lat, lon }) => ({ lat, lon }));
    expect(() => energyProfileForRoute(tiny, vehicle, conditions, null)).not.toThrow();
  });
});

describe("buildPlan con energyEngine v2", () => {
  it("usa la física v2 y el tiempo del perfil de velocidad", () => {
    const raw = hillRoute(60);
    const base = {
      raw,
      vehicle,
      conditions,
      chargers: [],
      weather: null,
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7.5, lon: -73 },
    };
    const legacy = buildPlan(base);
    const v2 = buildPlan({ ...base, energyEngine: "v2" });
    expect(legacy.energyEngine).toBe("legacy");
    expect(v2.energyEngine).toBe("v2");
    expect(v2.providerDriveMinutes).toBeCloseTo(raw.driveMinutes, 9);
    expect(v2.energyKwh).not.toBeCloseTo(legacy.energyKwh, 3);
    expect(v2.driveMinutes).not.toBeCloseTo(legacy.driveMinutes, 3);
    expect(v2.energyAssumptions?.length).toBeGreaterThan(0);
  });
});

describe("desvío con el perfil v2", () => {
  it("km de desvío × consumo local + costo de parar", () => {
    const out = energyProfileForRoute(hillRoute(40), vehicle, conditions, null);
    const fn = detourEnergyV2(out);
    const stopOnly = fn(0, 20);
    expect(stopOnly).toBeGreaterThan(0);
    expect(fn(4, 20)).toBeGreaterThan(stopOnly);
    // En la bajada (después de la cima) el consumo local es menor que en la subida.
    expect(fn(4, 35) - fn(0, 35)).toBeLessThan(fn(4, 5) - fn(0, 5));
  });
});

describe("energyProfileForRouteCached (M1, ADR-0020)", () => {
  const route = () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      km: i,
      lat: 7 - i * 0.009,
      lon: -73,
      elevM: 1000 + i * 5,
      slopePct: 0,
      speedKmh: 60,
    }));
    return {
      id: "r",
      label: "r",
      geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
      samples,
      distanceKm: 29,
      driveMinutes: 29,
      elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1150 },
    };
  };
  const vehicle = catalogVehicle("mg-s5-ev-comfort");
  const base = { ...conditions };

  it("mismo perfil si solo cambian el SOC, el margen o la estrategia", () => {
    const raw = route();
    const a = energyProfileForRouteCached(raw, vehicle, base, null);
    const b = energyProfileForRouteCached(
      raw,
      vehicle,
      { ...base, initialSoc: 20, safetyMode: "conservative", planningMode: "safer" },
      null,
    );
    expect(b).toBe(a);
  });

  it("otro perfil si cambia lo que cambia la física", () => {
    const raw = route();
    const a = energyProfileForRouteCached(raw, vehicle, base, null);
    expect(energyProfileForRouteCached(raw, vehicle, { ...base, drivingStyle: "sport" }, null)).not.toBe(a);
    expect(energyProfileForRouteCached(raw, vehicle, { ...base, luggageKg: 200 }, null)).not.toBe(a);
    expect(energyProfileForRouteCached(raw, { ...vehicle, weightKg: 2400 }, base, null)).not.toBe(a);
    expect(
      energyProfileForRouteCached(raw, vehicle, base, { temperatureC: 5, windKmh: 10, windDirDeg: 0 }),
    ).not.toBe(a);
  });

  it("la superficie de la vía también cambia el perfil (la clave la incluye)", () => {
    const raw = route();
    const rain = { temperatureC: 20, windKmh: 0, windDirDeg: 0, precipitationMm: 2 };
    const auto = energyProfileForRouteCached(raw, vehicle, base, rain);
    const dry = energyProfileForRouteCached(raw, vehicle, { ...base, roadSurface: "dry" }, rain);
    expect(dry).not.toBe(auto);
    expect(dry.totals.netEnergyKwh).toBeLessThan(auto.totals.netEnergyKwh);
    // "auto" y sin elegir son lo mismo.
    expect(energyProfileForRouteCached(raw, vehicle, { ...base, roadSurface: "auto" }, rain)).toBe(auto);
  });

  it("da el mismo resultado que sin memoria", () => {
    const raw = route();
    const cached = energyProfileForRouteCached(raw, vehicle, base, null);
    const fresh = energyProfileForRoute(raw, vehicle, base, null);
    expect(cached.samples).toEqual(fresh.samples);
    expect(cached.durationMinutes).toBe(fresh.durationMinutes);
  });

  it("otra ruta, otra memoria", () => {
    const a = energyProfileForRouteCached(route(), vehicle, base, null);
    const b = energyProfileForRouteCached(route(), vehicle, base, null);
    expect(b).not.toBe(a);
    expect(b.samples).toEqual(a.samples);
  });
});

describe("M2.1 · peajes en la energía v2 (ADR-0021)", () => {
  const flat = hillRoute(30);
  const base: RawRoute = {
    ...flat,
    samples: flat.samples.map((s) => ({ ...s, elevM: 1000 })),
    elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1000 },
  };

  it("cada caseta suma energía (frenar, arrancar y los auxiliares del tiempo detenido) y tiempo", () => {
    const plain = energyProfileForRoute(base, vehicle, conditions, null);
    const tolled = energyProfileForRoute({ ...base, tollBoothsKm: [10, 20] }, vehicle, conditions, null);
    expect(tolled.tollStops).toBe(2);
    expect(plain.tollStops).toBeUndefined();
    expect(tolled.totals.netEnergyKwh).toBeGreaterThan(plain.totals.netEnergyKwh);
    const seconds = MODEL_PARAMETERS.speed.tollStopSeconds.value;
    // Dos esperas más frenar y volver a acelerar: más de 2 × el tiempo detenido.
    expect((tolled.durationMinutes - plain.durationMinutes) * 60).toBeGreaterThan(2 * seconds);
    // El tiempo detenido paga los auxiliares: al menos base + aire por esos segundos.
    const idleMin = ((0.45 + 1.2) * seconds * 2) / 3600;
    expect(tolled.totals.auxiliaryEnergyKwh - plain.totals.auxiliaryEnergyKwh).toBeGreaterThan(idleMin);
  });

  it("sin casetas, la energía es exactamente la de antes", () => {
    const a = energyProfileForRoute(base, vehicle, conditions, null);
    const b = energyProfileForRoute({ ...base, tollBoothsKm: [] }, vehicle, conditions, null);
    expect(b.samples).toEqual(a.samples);
    expect(b.durationMinutes).toBe(a.durationMinutes);
  });

  it("el plan lo dice en sus supuestos", () => {
    const plan = buildPlan({
      raw: { ...base, tollBoothsKm: [15] },
      vehicle,
      conditions,
      chargers: [],
      weather: null,
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7.27, lon: -73 },
      engine: "v2",
      energyEngine: "v2",
    });
    const a = plan.assumptions?.find((x) => x.parameter === "speed.tollStopSeconds");
    expect(a).toMatchObject({ source: "estimated", value: { booths: 1 } });
  });
});

describe("M2.2 · vía mojada (ADR-0022)", () => {
  const flat = hillRoute(30);
  const route: RawRoute = {
    ...flat,
    samples: flat.samples.map((s) => ({ ...s, elevM: 1000 })),
    elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1000 },
  };
  const weather = (precipitationMm?: number) => ({
    temperatureC: 20,
    windKmh: 0,
    windDirDeg: 0,
    ...(precipitationMm != null ? { precipitationMm } : {}),
  });
  const kwh = (w: ReturnType<typeof weather> | null, roadSurface?: "auto" | "dry" | "wet") =>
    energyProfileForRoute(route, vehicle, { ...conditions, ...(roadSurface ? { roadSurface } : {}) }, w);

  it("con lluvia en el pronóstico gasta más: la rodadura sube y se encienden los limpiaparabrisas", () => {
    const dry = kwh(weather(0));
    const wet = kwh(weather(1.2));
    expect(wet.wetRoad).toBe("forecast");
    expect(dry.wetRoad).toBeUndefined();
    expect(wet.totals.netEnergyKwh).toBeGreaterThan(dry.totals.netEnergyKwh);
    // Crr × 1,2 en llano a velocidad de crucero: entre el 2 % y el 15 % más de energía.
    const extra = wet.totals.netEnergyKwh / dry.totals.netEnergyKwh - 1;
    expect(extra).toBeGreaterThan(0.02);
    expect(extra).toBeLessThan(0.15);
  });

  it("llovizna por debajo del umbral no cuenta como mojado", () => {
    expect(kwh(weather(0.1)).wetRoad).toBeUndefined();
  });

  it("sin dato de lluvia (clima sin precipitación o sin clima), la vía es seca como hoy", () => {
    const a = kwh(null);
    expect(kwh(weather()).samples).toEqual(a.samples);
    expect(a.wetRoad).toBeUndefined();
  });

  it("lo que elige el usuario manda sobre el pronóstico", () => {
    const rainy = weather(3);
    expect(kwh(rainy, "dry").wetRoad).toBeUndefined();
    expect(kwh(rainy, "dry").samples).toEqual(kwh(weather(0)).samples);
    const forced = kwh(weather(0), "wet");
    expect(forced.wetRoad).toBe("chosen");
    expect(forced.totals.netEnergyKwh).toBeCloseTo(kwh(rainy, "auto").totals.netEnergyKwh, 9);
  });

  it("el plan lo dice en sus supuestos", () => {
    const plan = buildPlan({
      raw: route,
      vehicle,
      conditions,
      chargers: [],
      weather: weather(2),
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7.27, lon: -73 },
      engine: "v2",
      energyEngine: "v2",
    });
    expect(plan.assumptions?.find((x) => x.parameter === "energy.wetRoad")).toMatchObject({
      source: "estimated",
      value: { origin: "forecast", crrFactor: 1.2 },
    });
  });
});

describe("M3.1 · clima por tramo y por hora (ADR-0024)", () => {
  const flat = hillRoute(30);
  const route: RawRoute = {
    ...flat,
    samples: flat.samples.map((s) => ({ ...s, elevM: 1000 })),
    elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1000 },
  };
  // La ruta va hacia el norte (rumbo 0°): un viento "desde 0°" es de frente, "desde 180°", de cola.
  const hourlyOf = (v: number) => [v, v, v, v, v, v];
  const point = (km: number, over: Record<string, number[]> = {}) => ({
    lat: 7 + km / 111.195,
    lon: -73,
    elevationM: 1000,
    startIso: "2026-10-03T12:00:00.000Z",
    temperatureC: hourlyOf(20),
    windKmh: hourlyOf(0),
    windDirDeg: hourlyOf(0),
    precipitationMm: hourlyOf(0),
    ...over,
    km,
  });
  const along = (points: ReturnType<typeof point>[], departIso = "2026-10-03T12:00:00.000Z") => ({
    departIso,
    points,
  });
  const noTemp = { ...conditions, temperatureC: null };
  const run = (field?: ReturnType<typeof along>, single: Parameters<typeof energyProfileForRoute>[3] = null) =>
    energyProfileForRoute(route, vehicle, noTemp, single, MODEL_PARAMETERS, field);

  it("el viento de frente solo en la primera mitad gasta entre ruta calma y de frente en toda la ruta", () => {
    const calm = run(along([point(0), point(30)]));
    const headHalf = run(
      along([
        point(0, { windKmh: hourlyOf(40) }),
        point(14, { windKmh: hourlyOf(40) }),
        point(15, { windKmh: hourlyOf(0) }),
        point(30, { windKmh: hourlyOf(0) }),
      ]),
    );
    const headAll = run(along([point(0, { windKmh: hourlyOf(40) }), point(30, { windKmh: hourlyOf(40) })]));
    expect(headHalf.totals.netEnergyKwh).toBeGreaterThan(calm.totals.netEnergyKwh);
    expect(headHalf.totals.netEnergyKwh).toBeLessThan(headAll.totals.netEnergyKwh);
    expect(headAll.weatherAlongPoints).toBe(2);
  });

  it("el mismo clima en todos los puntos da lo mismo que un solo punto con ese clima", () => {
    const wind = { temperatureC: 20, windKmh: 25, windDirDeg: 0, elevationM: 1000 };
    const single = run(undefined, wind);
    const field = run(
      along([point(0, { windKmh: hourlyOf(25) }), point(15, { windKmh: hourlyOf(25) }), point(30, { windKmh: hourlyOf(25) })]),
    );
    expect(field.totals.netEnergyKwh).toBeCloseTo(single.totals.netEnergyKwh, 9);
    expect(field.durationMinutes).toBeCloseTo(single.durationMinutes, 9);
  });

  it("la lluvia de un lugar solo moja los kilómetros que quedan cerca de él", () => {
    const dry = run(along([point(0), point(30)]));
    const rainEnd = run(
      along([point(0), point(15), point(16, { precipitationMm: hourlyOf(3) }), point(30, { precipitationMm: hourlyOf(3) })]),
    );
    const wetAll = run(
      along([point(0, { precipitationMm: hourlyOf(3) }), point(30, { precipitationMm: hourlyOf(3) })]),
    );
    expect(dry.wetRoad).toBeUndefined();
    expect(rainEnd.wetRoad).toBe("forecast");
    expect(rainEnd.totals.netEnergyKwh).toBeGreaterThan(dry.totals.netEnergyKwh);
    expect(rainEnd.totals.netEnergyKwh).toBeLessThan(wetAll.totals.netEnergyKwh);
  });

  it("la lluvia de una hora solo afecta lo que se recorre en esa hora", () => {
    // La ruta tarda ~30 min: llueve desde la tercera hora, no antes.
    const rainLater = along([
      point(0, { precipitationMm: [0, 0, 0, 3, 3, 3] }),
      point(30, { precipitationMm: [0, 0, 0, 3, 3, 3] }),
    ]);
    expect(run({ ...rainLater, departIso: "2026-10-03T12:00:00.000Z" }).wetRoad).toBeUndefined();
    expect(run({ ...rainLater, departIso: "2026-10-03T15:00:00.000Z" }).wetRoad).toBe("forecast");
  });

  it("la lluvia elegida por el usuario manda sobre un pronóstico seco", () => {
    const dryField = along([point(0), point(30)]);
    const forced = energyProfileForRoute(route, vehicle, { ...noTemp, roadSurface: "wet" }, null, MODEL_PARAMETERS, dryField);
    expect(forced.wetRoad).toBe("chosen");
  });

  it("la temperatura del clima por tramo cambia el consumo si el usuario no escribió una", () => {
    const warm = run(along([point(0), point(30)]));
    const cold = run(
      along([
        point(0, { temperatureC: hourlyOf(2) }),
        point(30, { temperatureC: hourlyOf(2) }),
      ]),
    );
    expect(cold.totals.netEnergyKwh).toBeGreaterThan(warm.totals.netEnergyKwh);
    // Con una temperatura escrita por el usuario, el clima no la cambia.
    const user = (field: ReturnType<typeof along>) =>
      energyProfileForRoute(route, vehicle, { ...conditions, temperatureC: 22 }, null, MODEL_PARAMETERS, field);
    expect(
      user(along([point(0, { temperatureC: hourlyOf(2) }), point(30, { temperatureC: hourlyOf(2) })])).totals.netEnergyKwh,
    ).toBeCloseTo(user(along([point(0), point(30)])).totals.netEnergyKwh, 9);
  });

  it("sin clima por tramo, la energía es la de antes y el resultado no lo menciona", () => {
    const a = run(undefined, { temperatureC: 20, windKmh: 10, windDirDeg: 90 });
    expect(a.weatherAlongPoints).toBeUndefined();
    const b = energyProfileForRoute(route, vehicle, noTemp, { temperatureC: 20, windKmh: 10, windDirDeg: 90 });
    expect(b.samples).toEqual(a.samples);
  });

  it("la memoria distingue el clima por tramo (otra serie, otro perfil)", () => {
    const f1 = along([point(0, { windKmh: hourlyOf(40) }), point(30, { windKmh: hourlyOf(40) })]);
    const f2 = along([point(0), point(30)]);
    const a = energyProfileForRouteCached(route, vehicle, noTemp, null, MODEL_PARAMETERS, f1);
    const b = energyProfileForRouteCached(route, vehicle, noTemp, null, MODEL_PARAMETERS, f2);
    expect(b).not.toBe(a);
    expect(energyProfileForRouteCached(route, vehicle, noTemp, null, MODEL_PARAMETERS, f1)).toBe(a);
  });

  it("el plan lo dice en sus supuestos", () => {
    const plan = buildPlan({
      raw: route,
      vehicle,
      conditions: noTemp,
      chargers: [],
      weather: null,
      weatherAlong: along([point(0), point(30)]),
      origin: { label: "A", lat: 7, lon: -73 },
      destination: { label: "B", lat: 7.27, lon: -73 },
      engine: "v2",
      energyEngine: "v2",
    });
    expect(plan.assumptions?.find((x) => x.parameter === "energy.weatherAlongRoute")).toMatchObject({
      source: "external_source",
      value: { points: 2, hours: 24 },
    });
  });
});

describe("M3.2 · la curva de eficiencia en el perfil completo", () => {
  const flatRoute = (km: number): RawRoute => {
    const r = hillRoute(km);
    return {
      ...r,
      samples: r.samples.map((s) => ({ ...s, elevM: 1000 })),
      elevation: { gainM: 0, lossM: 0, minM: 1000, maxM: 1000 },
    };
  };
  const noCurve = {
    ...MODEL_PARAMETERS,
    energy: {
      ...MODEL_PARAMETERS.energy,
      drivetrainEfficiencyCurve: { ...MODEL_PARAMETERS.energy.drivetrainEfficiencyCurve, value: [] },
    },
  };
  const at = (kmh: number, params: typeof MODEL_PARAMETERS, v = vehicle) =>
    energyProfileForRoute(flatRoute(40), v, { ...conditions, avgSpeedKmh: kmh, temperatureC: 15 }, null, params)
      .totals.netEnergyKwh;

  it("en crucero a la velocidad de referencia, casi no cambia; a poca velocidad, sube", () => {
    const refKmh = MODEL_PARAMETERS.energy.manualReferenceSpeedKmh;
    expect(Math.abs(at(refKmh, MODEL_PARAMETERS) / at(refKmh, noCurve) - 1)).toBeLessThan(0.015);
    expect(at(25, MODEL_PARAMETERS) / at(25, noCurve)).toBeGreaterThan(1.03);
  });

  it("el consumo manual sigue ajustado: el factor vale 1 en el crucero del vehículo ya calibrado", () => {
    const manual = { ...vehicle, consumptionKwhPer100km: 16 };
    const refKmh = MODEL_PARAMETERS.energy.manualReferenceSpeedKmh;
    const per100 = (params: typeof MODEL_PARAMETERS) => (at(refKmh, params, manual) / 40) * 100;
    // Con y sin curva, el consumo manual a la velocidad de referencia da lo mismo (± arranque y parada).
    expect(Math.abs(per100(MODEL_PARAMETERS) / per100(noCurve) - 1)).toBeLessThan(0.015);
  });
});
