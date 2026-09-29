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
