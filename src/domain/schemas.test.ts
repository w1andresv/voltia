import { describe, expect, it } from "vitest";
import { TripConditionsSchema, regenLevelFromLegacyPct, upgradeLegacyConditions } from "./schemas";
import { DEFAULT_CONDITIONS } from "./types";

describe("regeneración: de porcentaje a nivel", () => {
  it("traduce el porcentaje viejo a un nivel", () => {
    expect(regenLevelFromLegacyPct(5)).toBe("low");
    expect(regenLevelFromLegacyPct(20)).toBe("medium");
    expect(regenLevelFromLegacyPct(80)).toBe("high");
    expect(regenLevelFromLegacyPct(undefined)).toBe("medium");
  });

  it("condiciones guardadas con regenPct se leen con regenLevel", () => {
    const { regenLevel: _drop, ...legacyBase } = DEFAULT_CONDITIONS;
    void _drop;
    const upgraded = TripConditionsSchema.parse(
      upgradeLegacyConditions({ ...legacyBase, regenPct: 60 }),
    );
    expect(upgraded.regenLevel).toBe("high");
    expect("regenPct" in upgraded).toBe(false);
  });

  it("si ya trae nivel, se respeta", () => {
    const out = upgradeLegacyConditions({
      ...DEFAULT_CONDITIONS,
      regenLevel: "low",
      regenPct: 80,
    }) as {
      regenLevel: string;
    };
    expect(out.regenLevel).toBe("low");
  });

  it("sin ninguno de los dos, queda en media", () => {
    const { regenLevel: _drop, ...rest } = DEFAULT_CONDITIONS;
    void _drop;
    expect(TripConditionsSchema.parse(rest).regenLevel).toBe("medium");
  });
});
