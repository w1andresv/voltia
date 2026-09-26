import { describe, expect, it } from "vitest";
import type { ProviderRoute } from "@/domain/ev/contracts/route";
import {
  applyRoadTiers,
  applySegmentSpeeds,
  applySpeedLimits,
  buildSamples,
  speedProfile,
  toRawRoute,
  viaOf,
} from "./normalize";

function route(overrides: Partial<ProviderRoute> = {}): ProviderRoute {
  return {
    provider: "mapbox",
    profile: "driving",
    distanceM: 4000,
    durationS: 240,
    geometry: [7, 7.009, 7.018, 7.027, 7.036].map((lat) => ({ lat, lon: -73 })),
    legs: [],
    ...overrides,
  };
}

describe("speedProfile", () => {
  it("usa las anotaciones por par de puntos", () => {
    const r = route({
      legs: [{ annotation: { distanceM: [1000, 1000, 2000], durationS: [120, 60, 60] } }],
    });
    expect(speedProfile(r)).toEqual({ cumKm: [0, 1, 2, 4], cumS: [0, 120, 180, 240] });
  });

  it("sin anotaciones usa los pasos", () => {
    const r = route({
      legs: [
        {
          steps: [
            { distanceM: 2000, durationS: 60 },
            { distanceM: 2000, durationS: 180 },
          ],
        },
      ],
    });
    expect(speedProfile(r)).toEqual({ cumKm: [0, 2, 4], cumS: [0, 60, 240] });
  });

  it("sin anotaciones ni pasos devuelve null", () => {
    expect(speedProfile(route())).toBeNull();
    expect(speedProfile(route({ legs: [{ summary: "Ruta 45" }] }))).toBeNull();
  });

  it("ignora piezas inválidas y sin distancia ni tiempo devuelve null", () => {
    const r = route({ legs: [{ annotation: { distanceM: [-5, 0], durationS: [10, 0] } }] });
    expect(speedProfile(r)).toBeNull();
  });
});

describe("applySegmentSpeeds", () => {
  const base = { lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60 };
  const samples = [0, 1, 2, 3, 4].map((km) => ({ ...base, km }));

  it("cada muestra toma la velocidad del proveedor entre la anterior y ella", () => {
    const profile = { cumKm: [0, 2, 4], cumS: [0, 120, 240] };
    const fast = { cumKm: [0, 2, 4], cumS: [0, 180, 240] };
    expect(applySegmentSpeeds(samples, profile, 4).map((s) => Math.round(s.speedKmh))).toEqual([
      60, 60, 60, 60, 60,
    ]);
    expect(applySegmentSpeeds(samples, fast, 4).map((s) => Math.round(s.speedKmh))).toEqual([
      40, 40, 40, 120, 120,
    ]);
  });

  it("sin perfil deja las muestras como estaban", () => {
    expect(applySegmentSpeeds(samples, null, 4)).toBe(samples);
  });

  it("recorta a 8–130 km/h", () => {
    const crawl = { cumKm: [0, 4], cumS: [0, 36_000] };
    expect(applySegmentSpeeds(samples, crawl, 4).every((s) => s.speedKmh === 8)).toBe(true);
    const rocket = { cumKm: [0, 4], cumS: [0, 10] };
    expect(applySegmentSpeeds(samples, rocket, 4).every((s) => s.speedKmh === 130)).toBe(true);
  });
});

describe("buildSamples y toRawRoute", () => {
  it("muestrea cada 0,8 km como mínimo y cierra en el destino", () => {
    const pts = route().geometry;
    const s = buildSamples(pts, 4, 4);
    expect(s[0]!.km).toBe(0);
    expect(s.at(-1)!.km).toBe(4);
    expect(s.at(-1)!.lat).toBe(7.036);
    for (let i = 1; i < s.length; i++) expect(s[i]!.km).toBeGreaterThan(s[i - 1]!.km);
  });

  it("toRawRoute usa las anotaciones cuando vienen", () => {
    const r = route({
      legs: [
        { annotation: { distanceM: [1000, 1000, 1000, 1000], durationS: [180, 180, 30, 30] } },
      ],
    });
    const raw = toRawRoute(r, { id: "r", label: "Ruta" });
    const speeds = raw.samples.map((s) => s.speedKmh);
    expect(Math.min(...speeds)).toBeLessThan(30);
    expect(Math.max(...speeds)).toBeGreaterThan(100);
    expect(raw.distanceKm).toBe(4);
    expect(raw.driveMinutes).toBe(4);
    expect(raw.noTolls).toBeUndefined();
  });

  it("vías principales sin repetir, hasta 3", () => {
    expect(
      viaOf(
        route({
          legs: [{ summary: "Ruta 45A, Ruta 66" }, { summary: "Ruta 66, Ruta 62, Ruta 55" }],
        }),
      ),
    ).toBe("Ruta 45A, Ruta 66, Ruta 62");
    expect(viaOf(route({ legs: [{ summary: "" }] }))).toBeUndefined();
  });
});

describe("applySpeedLimits", () => {
  const samples = [0, 1, 2, 3, 4].map((km) => ({
    km,
    lat: 7,
    lon: -73,
    elevM: 0,
    slopePct: 0,
    speedKmh: 60,
  }));

  it("cada muestra toma el menor límite conocido entre la anterior y ella", () => {
    const r = route({
      legs: [
        {
          annotation: {
            distanceM: [1500, 1000, 1500],
            durationS: [60, 60, 60],
            maxspeedKmh: [80, 60, null],
          },
        },
      ],
    });
    const out = applySpeedLimits(samples, r, 4);
    expect(out.map((s) => s.speedLimitKmh)).toEqual([undefined, 80, 60, 60, undefined]);
  });

  it("sin anotación de límite, o sin ningún dato, no cambia nada", () => {
    expect(
      applySpeedLimits(
        samples,
        route({ legs: [{ annotation: { distanceM: [4000], durationS: [240] } }] }),
        4,
      ),
    ).toBe(samples);
    expect(
      applySpeedLimits(
        samples,
        route({
          legs: [{ annotation: { distanceM: [4000], durationS: [240], maxspeedKmh: [null] } }],
        }),
        4,
      ),
    ).toBe(samples);
  });

  it("toRawRoute lleva el límite a las muestras", () => {
    const r = route({
      legs: [{ annotation: { distanceM: [4000], durationS: [240], maxspeedKmh: [90] } }],
    });
    const raw = toRawRoute(r, { id: "a", label: "A" });
    expect(raw.samples.slice(1).every((s) => s.speedLimitKmh === 90)).toBe(true);
  });
});

describe("puntos intermedios y clase vial en toRawRoute (F5)", () => {
  it("guarda el km de cada punto intermedio, escalado a la distancia", () => {
    const r = route({ distanceM: 4000, legs: [{ distanceM: 1500 }, { distanceM: 2500 }] });
    expect(toRawRoute(r, { id: "a", label: "A" }).legBoundariesKm).toEqual([1.5]);
    expect(
      toRawRoute(route({ legs: [{ distanceM: 4000 }] }), { id: "a", label: "A" }).legBoundariesKm,
    ).toBeUndefined();
  });

  it("cada muestra toma la clase vial con más km en su tramo", () => {
    const step = (km: number, cls: string, lat0: number) => ({
      distanceM: km * 1000,
      durationS: km * 60,
      geometry: [
        { lat: lat0, lon: -73 },
        { lat: lat0 + km / 111, lon: -73 },
      ],
      intersections: [{ location: { lat: lat0, lon: -73 }, roadClass: cls }],
    });
    const r = route({
      legs: [{ steps: [step(1.4, "primary", 7), step(2.6, "tertiary", 7 + 1.4 / 111)] }],
    });
    const samples = [0, 1, 2, 3, 4].map((km) => ({
      km,
      lat: 7,
      lon: -73,
      elevM: 0,
      slopePct: 0,
      speedKmh: 60,
    }));
    const out = applyRoadTiers(samples, r, 4);
    expect(out.map((s) => s.roadTier)).toEqual([
      undefined,
      "primary",
      "tertiary",
      "tertiary",
      "tertiary",
    ]);
    expect(applyRoadTiers(samples, route({ legs: [] }), 4)).toBe(samples);
  });
});

describe("túneles (F2b)", () => {
  it("una intersección con la clase tunnel marca el tramo hasta la siguiente", () => {
    const line = [0, 1, 2, 3, 4].map((km) => ({ lat: 7 + km / 111.195, lon: -73 }));
    const r = route({
      distanceM: 4000,
      geometry: line,
      legs: [
        {
          distanceM: 4000,
          steps: [
            {
              distanceM: 4000,
              durationS: 240,
              geometry: line,
              intersections: [
                { location: line[0]!, roadClass: "primary" },
                { location: line[1]!, roadClass: "primary", classes: ["tunnel"] },
                { location: line[3]!, roadClass: "primary" },
              ],
            },
          ],
        },
      ],
    });
    const raw = toRawRoute(r, { id: "a", label: "A" });
    expect(raw.structures).toHaveLength(1);
    expect(raw.structures![0]!.kind).toBe("tunnel");
    expect(raw.structures![0]!.fromKm).toBeCloseTo(1, 3);
    expect(raw.structures![0]!.toKm).toBeCloseTo(3, 3);
  });

  it("sin túneles no agrega el campo", () => {
    expect(toRawRoute(route(), { id: "a", label: "A" }).structures).toBeUndefined();
  });
});
