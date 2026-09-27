import { describe, expect, it } from "vitest";
import { batteryDepletion } from "./depletion";

const s = (km: number, soc: number) => ({ km, lat: 4 + km / 100, lon: -74, soc });

describe("batteryDepletion", () => {
  it("sin SOC negativo no hay punto de agotamiento", () => {
    expect(batteryDepletion([s(0, 80), s(10, 0), s(20, 5)])).toBeNull();
  });

  it("interpola dónde el SOC cruza el 0 %", () => {
    const d = batteryDepletion([s(0, 30), s(100, 10), s(200, -10), s(300, -30)])!;
    expect(d.km).toBeCloseTo(150, 9);
    expect(d.lat).toBeCloseTo(5.5, 9);
    expect(d.lon).toBe(-74);
  });

  it("si ya sale negativo, es el origen", () => {
    expect(batteryDepletion([s(0, -2), s(10, -5)])?.km).toBe(0);
  });
});
