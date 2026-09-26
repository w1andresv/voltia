import { describe, expect, it } from "vitest";
import { chartWindowKm, consumptionSeries, consumptionWindows, socSeries } from "./series";

/** Muestras con consumo constante `rate` kWh/km salvo en [downFrom, downTo], donde regenera `regen` kWh/km. */
function samples(kms: number[], rate: number, down?: { from: number; to: number; regen: number }) {
  let cum = 0;
  return kms.map((km, i) => {
    if (i > 0) {
      const a = kms[i - 1]!;
      const d = km - a;
      const inDown = down && a >= down.from && km <= down.to;
      cum += inDown ? -down.regen * d : rate * d;
    }
    return { km, cumulativeKwh: cum };
  });
}

describe("chartWindowKm", () => {
  it("1 km bajo 50, 2 km hasta 200 y 5 km desde ahí", () => {
    expect(chartWindowKm(10)).toBe(1);
    expect(chartWindowKm(49.9)).toBe(1);
    expect(chartWindowKm(50)).toBe(2);
    expect(chartWindowKm(199)).toBe(2);
    expect(chartWindowKm(200)).toBe(5);
    expect(chartWindowKm(900)).toBe(5);
  });
});

describe("consumptionWindows", () => {
  it("la suma de las ventanas es el total (invariante §5.10), con muestras irregulares", () => {
    const s = samples([0, 0.7, 1.9, 2.2, 4.8, 5.1, 7.3, 9.95, 12.4], 0.17, {
      from: 4.8,
      to: 7.3,
      regen: 0.05,
    });
    const w = consumptionWindows(s, 2);
    const sum = w.reduce((a, x) => a + x.kwh, 0);
    expect(sum).toBeCloseTo(s[s.length - 1]!.cumulativeKwh, 12);
    expect(w[0]).toMatchObject({ fromKm: 0, toKm: 2, midKm: 1 });
    expect(w[w.length - 1]!.toKm).toBeCloseTo(12.4, 12);
  });

  it("prorratea un tramo que cruza el borde: consumo constante da la misma tasa en cada ventana", () => {
    const w = consumptionWindows(samples([0, 3.5, 7], 0.2), 1);
    expect(w).toHaveLength(7);
    for (const x of w) expect(x.kwhPer100).toBeCloseTo(20, 10);
  });

  it("una bajada que regenera da consumo negativo en su ventana", () => {
    const w = consumptionWindows(samples([0, 1, 2, 3], 0.15, { from: 1, to: 2, regen: 0.04 }), 1);
    expect(w.map((x) => Math.round(x.kwhPer100))).toEqual([15, -4, 15]);
  });

  it("sin distancia o sin ventana no hay series", () => {
    expect(consumptionWindows([], 1)).toEqual([]);
    expect(consumptionWindows(samples([0], 0.1), 1)).toEqual([]);
    expect(consumptionWindows(samples([0, 0], 0.1), 1)).toEqual([]);
    expect(consumptionWindows(samples([0, 5], 0.1), 0)).toEqual([]);
  });
});

describe("consumptionSeries", () => {
  it("cada muestra lleva el consumo de su ventana y el promedio acumulado", () => {
    const s = samples([0, 0.2, 1, 2, 3], 0.15, { from: 1, to: 2, regen: 0.04 });
    const { windowKm, points } = consumptionSeries(s);
    expect(windowKm).toBe(1);
    expect(points.map((p) => Math.round(p.windowKwhPer100!))).toEqual([15, 15, 15, -4, 15]);
    expect(points[1]!.cumulativeKwhPer100).toBeNull();
    expect(points[4]!.cumulativeKwhPer100).toBeCloseTo(((0.15 * 2 - 0.04) / 3) * 100, 10);
  });

  it("sin muestras no falla", () => {
    expect(consumptionSeries([])).toEqual({ windowKm: 1, windows: [], points: [] });
  });
});

describe("socSeries", () => {
  const route = [
    { km: 0, soc: 80 },
    { km: 50, soc: 60 },
    { km: 100, soc: 70 },
    { km: 150, soc: 50 },
  ];

  it("sin paradas es el SOC de cada muestra", () => {
    expect(socSeries(route).map((p) => p.soc)).toEqual([80, 60, 70, 50]);
  });

  it("la parada aparece como un salto: llega y sale en el mismo km", () => {
    const out = socSeries(route, [{ kmAlongRoute: 100, arriveSoc: 40, departSoc: 70 }]);
    expect(out).toEqual([
      { km: 0, soc: 80, kind: "route" },
      { km: 50, soc: 60, kind: "route" },
      { km: 100, soc: 40, kind: "arrive" },
      { km: 100, soc: 70, kind: "depart" },
      { km: 150, soc: 50, kind: "route" },
    ]);
  });

  it("una parada entre muestras o al final se intercala en orden", () => {
    const out = socSeries(route, [
      { kmAlongRoute: 160, arriveSoc: 45, departSoc: 50 },
      { kmAlongRoute: 75, arriveSoc: 50, departSoc: 80 },
    ]);
    expect(out.map((p) => `${p.km}:${p.kind}`)).toEqual([
      "0:route",
      "50:route",
      "75:arrive",
      "75:depart",
      "100:route",
      "150:route",
      "160:arrive",
      "160:depart",
    ]);
  });
});
