import { describe, expect, it } from "vitest";
import {
  batteryCurve,
  energyPerKm,
  GUIDE_DIST_KM,
  GUIDE_PRESETS,
  solveGuide,
  type GuideEngine,
  type GuideParams,
} from "./guide-sim";

// Resultados de las demos originales (artifacts de v1 y v2) para los mismos casos:
// [paradas "nombre llega→sale", carga previa, llegada a Vélez, minutos cargando].
const CASES: Record<string, GuideParams> = {
  ...GUIDE_PRESETS,
  sanGilFewer: {
    soc: 60,
    passengers: 1,
    consumption: 20,
    margin: 15,
    arrival: 15,
    cap: 80,
    strategy: "fewer",
    sanGil: true,
    fastBuffer: 0,
  },
  safer: {
    soc: 70,
    passengers: 3,
    consumption: 24,
    margin: 10,
    arrival: 20,
    cap: 100,
    strategy: "safer",
    sanGil: true,
    fastBuffer: 10,
  },
};

const EXPECTED: Record<GuideEngine, Record<string, [string[], number, number, number]>> = {
  v1: {
    local: [["Socorro 30→60", "Santana 22→50"], 0, 22, 41],
    vercel: [["Socorro 20→89"], 1, 22, 42],
    low: [["Socorro 15→66"], 16, 17, 31],
    sanGilFewer: [["San Gil 16→64", "Santana 19→44"], 0, 19, 218],
    safer: [["San Gil 19→72", "Santana 19→54"], 0, 24, 246],
  },
  v2: {
    local: [["Socorro 30→69", "Santana 31→59"], 0, 31, 45],
    vercel: [["Socorro 20→90"], 1, 23, 43],
    low: [["Socorro 15→75"], 16, 26, 35],
    sanGilFewer: [["San Gil 16→27", "Socorro 15→74"], 0, 15, 87],
    safer: [["San Gil 19→33", "Socorro 19→90"], 0, 21, 110],
  },
};

const town = (name: string) =>
  name.split(" · ").at(-1)!.replace("EDS ", "").replace(" (ejemplo)", "");

describe("modelo de las guías: mismo resultado que las demos originales", () => {
  for (const engine of ["v1", "v2"] as const) {
    for (const [name, params] of Object.entries(CASES)) {
      it(`${engine} · ${name}`, () => {
        const r = solveGuide(engine, params);
        expect(r.viable).toBe(true);
        if (!r.viable) return;
        const [stops, pre, arrival, minutes] = EXPECTED[engine][name]!;
        expect(
          r.stops.map((s) => `${town(s.station.name)} ${s.arrive.toFixed(0)}→${s.depart}`),
        ).toEqual(stops);
        expect(r.preCharge).toBe(pre);
        expect(r.arrival.toFixed(0)).toBe(String(arrival));
        expect(r.minutes.toFixed(0)).toBe(String(minutes));
      });
    }
  }

  it("si ninguna carga alcanza, no es viable", () => {
    const r = solveGuide("v2", { ...GUIDE_PRESETS.local, arrival: 95 });
    expect(r.viable).toBe(false);
  });

  it("la curva de batería salta en cada parada y termina en el destino", () => {
    const p = GUIDE_PRESETS.local;
    const r = solveGuide("v2", p);
    if (!r.viable) throw new Error("debería ser viable");
    const pts = batteryCurve(energyPerKm(p), p.soc, r.stops);
    expect(pts.at(-1)![0]).toBe(GUIDE_DIST_KM);
    expect(pts.at(-1)![1]).toBeCloseTo(r.arrival, 6);
    expect(pts).toContainEqual([98, 69]);
  });
});
