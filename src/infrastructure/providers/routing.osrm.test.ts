import { describe, expect, it } from "vitest";
import { applySegmentSpeeds, speedProfile, toRawRoute, type OsrmRoute } from "./routing.osrm";

function route(overrides: Partial<OsrmRoute> = {}): OsrmRoute {
  return {
    distance: 4000,
    duration: 240,
    geometry: {
      coordinates: [
        [-73, 7],
        [-73, 7.009],
        [-73, 7.018],
        [-73, 7.027],
        [-73, 7.036],
      ],
    },
    ...overrides,
  };
}

describe("speedProfile", () => {
  it("usa las anotaciones por par de puntos", () => {
    const r = route({
      legs: [{ annotation: { distance: [1000, 1000, 2000], duration: [120, 60, 60] } }],
    });
    expect(speedProfile(r)).toEqual({ cumKm: [0, 1, 2, 4], cumS: [0, 120, 180, 240] });
  });

  it("sin anotaciones usa los pasos", () => {
    const r = route({
      legs: [
        {
          steps: [
            { distance: 2000, duration: 60 },
            { distance: 2000, duration: 180 },
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
});

describe("applySegmentSpeeds", () => {
  const base = { lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60 };
  const samples = [0, 1, 2, 3, 4].map((km) => ({ ...base, km }));

  it("cada muestra toma la velocidad del motor entre la anterior y ella", () => {
    const profile = { cumKm: [0, 2, 4], cumS: [0, 120, 240] }; // 60 km/h y luego 60 km/h
    const fast = { cumKm: [0, 2, 4], cumS: [0, 180, 240] }; // 40 km/h y luego 120 km/h
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

  it("toRawRoute usa las anotaciones cuando vienen", () => {
    const r = route({
      legs: [{ annotation: { distance: [1000, 1000, 1000, 1000], duration: [180, 180, 30, 30] } }],
    });
    const raw = toRawRoute(r, { id: "r", label: "Ruta" });
    const speeds = raw.samples.map((s) => s.speedKmh);
    expect(Math.min(...speeds)).toBeLessThan(30);
    expect(Math.max(...speeds)).toBeGreaterThan(100);
  });
});
