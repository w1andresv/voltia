import { describe, expect, it } from "vitest";
import { arrivalText } from "./arrival-text";

const at = "2026-09-26T00:00:00Z";

describe("arrivalText", () => {
  it("dice si el plan fue optimista, conservador o acertó", () => {
    expect(
      arrivalText({ arrivalSoc: 35, predictedArrivalSoc: 39.5, errorPct: 4.5, recordedAt: at }),
    ).toMatch(/optimista por 4,5 puntos/);
    expect(
      arrivalText({ arrivalSoc: 42, predictedArrivalSoc: 39, errorPct: -3, recordedAt: at }),
    ).toMatch(/conservador por 3 puntos/);
    expect(
      arrivalText({ arrivalSoc: 39, predictedArrivalSoc: 39.4, errorPct: 0.4, recordedAt: at }),
    ).toMatch(/acertó/);
  });
});
