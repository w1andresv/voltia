import { describe, expect, it } from "vitest";
import type { RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import {
  buildSpeedProfile,
  circleRadiusM,
  curvatureRadii,
  speedMesh,
  type SpeedInputPoint,
} from "./engine";

const KM_PER_DEG = 111.195;

function straight(km: number, typicalKmh = 90, limit?: number): RawRoute {
  const at = (d: number) => ({ lat: 7 + d / KM_PER_DEG, lon: -73 });
  const samples = Array.from({ length: km + 1 }, (_, i) => ({
    km: i,
    ...at(i),
    elevM: 0,
    slopePct: 0,
    speedKmh: typicalKmh,
    ...(limit ? { speedLimitKmh: limit } : {}),
  }));
  return {
    id: "r",
    label: "r",
    geometry: samples.map(({ lat, lon }) => ({ lat, lon })),
    samples,
    distanceKm: km,
    driveMinutes: (km / typicalKmh) * 60,
    elevation: { gainM: 0, lossM: 0, minM: 0, maxM: 0 },
  };
}

describe("speedMesh", () => {
  it("un punto cada 100 m más el km de cada muestra, con la velocidad típica y el límite de su tramo", () => {
    const route = straight(2, 80, 60);
    route.samples[1]!.km = 1.05; // una muestra fuera de la malla de 100 m
    const mesh = speedMesh(route, 100);
    expect(mesh.map((p) => p.km)).toContain(1.05);
    expect(mesh[0]!.km).toBe(0);
    expect(mesh[mesh.length - 1]!.km).toBe(2);
    expect(mesh.every((p) => p.typicalKmh === 80 && p.limitKmh === 60)).toBe(true);
    expect(mesh[5]!.headingDeg).toBeCloseTo(0, 6);
  });

  it("la velocidad fija del usuario reemplaza la típica", () => {
    expect(speedMesh(straight(1), 100, 65).every((p) => p.typicalKmh === 65)).toBe(true);
  });
});

describe("curvatura", () => {
  it("el radio del círculo por tres puntos de una circunferencia es su radio", () => {
    const R = 200; // m
    const c = { lat: 7, lon: -73 };
    const pt = (deg: number) => ({
      km: 0,
      lat: c.lat + (R * Math.sin((deg * Math.PI) / 180)) / 110_574,
      lon:
        c.lon +
        (R * Math.cos((deg * Math.PI) / 180)) / (111_320 * Math.cos((c.lat * Math.PI) / 180)),
    });
    expect(circleRadiusM(pt(0), pt(20), pt(40))).toBeCloseTo(R, -1);
    expect(
      circleRadiusM(
        { km: 0, lat: 7, lon: -73 },
        { km: 0, lat: 7.001, lon: -73 },
        { km: 0, lat: 7.002, lon: -73 },
      ),
    ).toBe(Infinity);
  });

  it("en recta el radio es infinito y en los extremos no hay vecinos", () => {
    const mesh = speedMesh(straight(1), 100);
    const radii = curvatureRadii(mesh, 100);
    expect(radii[0]).toBe(Infinity);
    expect(radii[5]).toBe(Infinity);
  });
});

function points(
  n: number,
  spacingKm: number,
  typical: number,
  extra: Partial<SpeedInputPoint> = {},
): SpeedInputPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    km: i * spacingKm,
    lat: 7 + (i * spacingKm) / KM_PER_DEG,
    lon: -73,
    typicalKmh: typical,
    headingDeg: 0,
    ...extra,
  }));
}

describe("buildSpeedProfile", () => {
  const modes = MODEL_PARAMETERS.speed.modes.value;

  it("0 en origen y destino, acelera y frena con los límites del modo", () => {
    const p = buildSpeedProfile(points(101, 0.1, 90), "normal");
    expect(p.points[0]!.speedKmh).toBe(0);
    expect(p.points[100]!.speedKmh).toBe(0);
    expect(p.points[0]!.limitingFactor).toBe("stop");
    // A 1,2 m/s² se llega a 90 km/h (25 m/s) en 260 m.
    expect(p.points[1]!.speedKmh).toBeCloseTo(
      Math.sqrt(2 * modes.normal.maxAccelMs2 * 100) * 3.6,
      9,
    );
    expect(p.points[1]!.limitingFactor).toBe("acceleration");
    expect(p.points[50]!.speedKmh).toBeCloseTo(90, 9);
    expect(p.points[99]!.limitingFactor).toBe("deceleration");
    for (const pt of p.points) {
      expect(pt.accelerationMs2).toBeLessThanOrEqual(modes.normal.maxAccelMs2 + 1e-9);
      expect(pt.accelerationMs2).toBeGreaterThanOrEqual(-modes.normal.maxDecelMs2 - 1e-9);
    }
    // 10 km a ~90 km/h: poco más de 400 s por arrancar y parar.
    expect(p.durationMinutes * 60).toBeGreaterThan(400);
    expect(p.durationMinutes * 60).toBeLessThan(420);
  });

  it("el límite legal manda aunque el modo pida más", () => {
    const p = buildSpeedProfile(points(51, 0.1, 100, { limitKmh: 80 }), "sport");
    expect(p.points[25]!.speedKmh).toBeCloseTo(80, 9);
    expect(p.points[25]!.limitingFactor).toBe("speed_limit");
  });

  it("eficiente va al 90 % de la típica; sport sube hasta el límite", () => {
    const eff = buildSpeedProfile(points(51, 0.1, 100), "efficient");
    expect(eff.points[25]!.speedKmh).toBeCloseTo(90, 9);
    const sport = buildSpeedProfile(points(51, 0.1, 100), "sport");
    expect(sport.points[25]!.speedKmh).toBeCloseTo(108, 9);
    expect(eff.durationMinutes).toBeGreaterThan(sport.durationMinutes);
  });

  it("una curva cerrada baja la velocidad a √(a_lat·R)", () => {
    // Recta hacia el norte y giro de 90° hacia el este en el punto 20.
    const pts = points(41, 0.1, 90).map((p, i) =>
      i <= 20
        ? p
        : {
            ...p,
            lat: 7 + (20 * 0.1) / KM_PER_DEG,
            lon: -73 + ((i - 20) * 0.1) / (111.32 * Math.cos((7 * Math.PI) / 180)),
          },
    );
    const prof = buildSpeedProfile(pts, "normal");
    expect(prof.points[20]!.limitingFactor).toBe("curvature");
    // Vecinos a 100 m de un giro de 90°: R = 100·100·141,4 / (4·5000) ≈ 70,7 m → √(2·70,7)·3,6 ≈ 42,8 km/h.
    expect(prof.points[20]!.speedKmh).toBeCloseTo(Math.sqrt(2 * 70.7) * 3.6, 0);
  });

  it("menos de dos puntos: perfil vacío", () => {
    expect(buildSpeedProfile(points(1, 0.1, 90), "normal")).toMatchObject({
      points: [],
      durationMinutes: 0,
    });
  });
});

describe("paradas intermedias y tope por clase vial (F5)", () => {
  it("se detiene en los puntos intermedios de la ruta", () => {
    const route = { ...straight(4), legBoundariesKm: [2, 0, 4] };
    const mesh = speedMesh(route, 100);
    const at2 = mesh.findIndex((p) => Math.abs(p.km - 2) < 1e-9);
    expect(mesh[at2]!.stop).toBe(true);
    expect(mesh.filter((p) => p.stop)).toHaveLength(1); // 0 y 4 son origen y destino
    const prof = buildSpeedProfile(mesh, "normal");
    expect(prof.points[at2]!.speedKmh).toBe(0);
    expect(prof.points[at2]!.limitingFactor).toBe("stop");
    expect(prof.points[at2 - 1]!.limitingFactor).toBe("deceleration");
    expect(prof.points[at2 + 1]!.limitingFactor).toBe("acceleration");
  });

  it("sin límite legal manda el tope de la clase vial; con límite, el límite", () => {
    const tertiary = buildSpeedProfile(points(51, 0.1, 90, { roadTier: "tertiary" }), "normal");
    expect(tertiary.points[25]!.speedKmh).toBeCloseTo(60, 9);
    expect(tertiary.points[25]!.limitingFactor).toBe("road_class_default");
    const withLimit = buildSpeedProfile(
      points(51, 0.1, 90, { roadTier: "tertiary", limitKmh: 70 }),
      "normal",
    );
    expect(withLimit.points[25]!.speedKmh).toBeCloseTo(70, 9);
    const unknown = buildSpeedProfile(points(51, 0.1, 90, { roadTier: "unknown" }), "normal");
    expect(unknown.points[25]!.speedKmh).toBeCloseTo(90, 9);
  });

  it("la malla lleva la clase vial de la muestra", () => {
    const route = straight(2);
    route.samples = route.samples.map((s) => ({ ...s, roadTier: "secondary" as const }));
    expect(speedMesh(route, 100).every((p) => p.roadTier === "secondary")).toBe(true);
  });
});
