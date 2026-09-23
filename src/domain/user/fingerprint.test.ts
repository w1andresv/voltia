import { describe, expect, it } from "vitest";
import { tripFingerprint, vehicleFingerprint } from "./fingerprint";
import { makeRequest, makeVehicle } from "./test-fixtures";

describe("vehicleFingerprint", () => {
  it("ignora mayúsculas y espacios extra", () => {
    const a = makeVehicle({ brand: " BYD ", model: "Dolphin  Mini" });
    const b = makeVehicle({ brand: "byd", model: "dolphin mini" });
    expect(vehicleFingerprint(a)).toBe(vehicleFingerprint(b));
  });

  it("distingue versión, año, batería y autonomía", () => {
    const base = vehicleFingerprint(makeVehicle());
    expect(vehicleFingerprint(makeVehicle({ version: "otra" }))).not.toBe(base);
    expect(vehicleFingerprint(makeVehicle({ year: 2025 }))).not.toBe(base);
    expect(vehicleFingerprint(makeVehicle({ batteryKwh: 61 }))).not.toBe(base);
    expect(vehicleFingerprint(makeVehicle({ rangeKm: 401 }))).not.toBe(base);
  });

  it("no depende del id local", () => {
    expect(vehicleFingerprint(makeVehicle({ id: "a" }))).toBe(
      vehicleFingerprint(makeVehicle({ id: "b" })),
    );
  });
});

describe("tripFingerprint", () => {
  it("redondea coordenadas a 3 decimales (~100 m; es una rejilla, no un radio)", () => {
    const a = makeRequest();
    const b = makeRequest({ origin: { ...a.origin, lat: a.origin.lat + 0.0001 } });
    expect(tripFingerprint(a)).toBe(tripFingerprint(b));
  });

  it("distingue un origen a más de ~100 m", () => {
    const a = makeRequest();
    const b = makeRequest({ origin: { ...a.origin, lat: a.origin.lat + 0.01 } });
    expect(tripFingerprint(a)).not.toBe(tripFingerprint(b));
  });

  it("incluye paradas, vehículo, modo e initialSoc", () => {
    const base = tripFingerprint(makeRequest());
    const wp = { label: "P", lat: 6, lon: -73 };
    expect(tripFingerprint(makeRequest({ waypoints: [wp] }))).not.toBe(base);
    expect(tripFingerprint(makeRequest({ vehicle: makeVehicle({ id: "otro" }) }))).not.toBe(base);
    const r = makeRequest();
    expect(
      tripFingerprint({ ...r, conditions: { ...r.conditions, planningMode: "safer" } }),
    ).not.toBe(base);
    expect(tripFingerprint({ ...r, conditions: { ...r.conditions, initialSoc: 55 } })).not.toBe(
      base,
    );
  });
});
