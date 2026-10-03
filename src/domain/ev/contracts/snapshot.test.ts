import { describe, expect, it } from "vitest";
import { minimalSnapshot } from "@/test-support/snapshot-fixture";
import {
  MAX_SNAPSHOT_BYTES,
  parsePlanningSnapshot,
  snapshotHash,
  snapshotInputs,
} from "./snapshot";

describe("parsePlanningSnapshot", () => {
  it("acepta un snapshot válido tal cual, con campos extra", () => {
    const s = minimalSnapshot();
    const withExtra = { ...s, chargers: [{ ...s.chargers[0]!, operator: "Terpel" }] };
    expect(parsePlanningSnapshot(JSON.parse(JSON.stringify(withExtra)))).toEqual(withExtra);
  });

  it("null, indefinido o sin rutas no es un snapshot", () => {
    expect(parsePlanningSnapshot(null)).toBeNull();
    expect(parsePlanningSnapshot(undefined)).toBeNull();
    expect(parsePlanningSnapshot(minimalSnapshot({ routes: [] }))).toBeNull();
  });

  it("rechaza otra versión del esquema o campos que el planificador lee con otro tipo", () => {
    expect(parsePlanningSnapshot({ ...minimalSnapshot(), schemaVersion: 2 })).toBeNull();
    const s = minimalSnapshot();
    const badSample = { ...s, routes: [{ ...s.routes[0]!, samples: [{ km: "0" }] }] };
    expect(parsePlanningSnapshot(badSample)).toBeNull();
    expect(parsePlanningSnapshot({ ...s, plannerEngine: "v3" })).toBeNull();
  });

  it("rechaza uno demasiado grande", () => {
    const s = minimalSnapshot({ warnings: ["x".repeat(MAX_SNAPSHOT_BYTES)] });
    expect(parsePlanningSnapshot(s)).toBeNull();
  });
});

describe("snapshotInputs", () => {
  it("da rutas, cargadores y clima para computePlans", () => {
    const s = minimalSnapshot();
    expect(snapshotInputs(s)).toEqual({
      routes: s.routes,
      chargers: s.chargers,
      weather: s.weather,
    });
  });
});

describe("snapshotHash", () => {
  it("mismos datos, mismo id, aunque cambien la fecha, los avisos o la pasada 2", () => {
    const s = minimalSnapshot();
    const again = minimalSnapshot({ createdAt: "2027-01-01T00:00:00.000Z", warnings: ["otro"] });
    expect(snapshotHash(again)).toBe(snapshotHash(s));
    expect(snapshotHash(s)).toMatch(/^[0-9a-f]{14}$/);
  });

  it("cambia si cambian los datos o el modelo", () => {
    const s = minimalSnapshot();
    expect(snapshotHash({ ...s, modelVersion: "1.0.0" })).not.toBe(snapshotHash(s));
    expect(snapshotHash({ ...s, chargers: [] })).not.toBe(snapshotHash(s));
  });

  it("snapshotInputs pasa el id y la calidad de los datos cuando los hay", () => {
    const s = minimalSnapshot({ snapshotId: "abc", dataQuality: { elevation: "unavailable" } });
    expect(snapshotInputs(s)).toMatchObject({
      snapshotId: "abc",
      dataQuality: { elevation: "unavailable" },
    });
  });
});

describe("M2 y M3: campos nuevos opcionales del snapshot", () => {
  const along = {
    "route-0": {
      departIso: "2026-10-03T14:20:00.000Z",
      source: "fake",
      points: [
        {
          km: 0,
          lat: 7,
          lon: -73,
          elevationM: 1000,
          startIso: "2026-10-03T14:00:00.000Z",
          temperatureC: [18, 18],
          windKmh: [5, 6],
          windDirDeg: [200, 210],
          precipitationMm: [0, 1],
        },
      ],
    },
  };

  it("un snapshot con clima por tramo y casetas se valida", () => {
    const base = minimalSnapshot();
    const s = {
      ...base,
      weatherAlong: along,
      routes: [{ ...base.routes[0]!, tollBoothsKm: [4.2] }],
    };
    const parsed = parsePlanningSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed?.weatherAlong?.["route-0"]?.points).toHaveLength(1);
    expect(parsed?.routes[0]?.tollBoothsKm).toEqual([4.2]);
  });

  it("rechaza un clima por tramo mal formado", () => {
    const bad = { ...minimalSnapshot(), weatherAlong: { "route-0": { departIso: 5, points: [] } } };
    expect(parsePlanningSnapshot(bad)).toBeNull();
  });

  it("la huella de un snapshot sin clima por tramo es la de siempre; con él, otra", () => {
    const s = minimalSnapshot();
    expect(snapshotHash(s)).toBe(snapshotHash({ ...s, weatherAlong: undefined }));
    expect(snapshotHash({ ...s, weatherAlong: along })).not.toBe(snapshotHash(s));
  });

  it("snapshotInputs pasa el clima por tramo solo si existe", () => {
    expect(snapshotInputs(minimalSnapshot())).not.toHaveProperty("weatherAlong");
    expect(snapshotInputs(minimalSnapshot({ weatherAlong: along }))).toHaveProperty("weatherAlong");
  });
});
