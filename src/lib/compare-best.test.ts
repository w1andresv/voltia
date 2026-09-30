import { describe, expect, it } from "vitest";
import type { RoutePlan } from "@/domain/types";
import { bestOf } from "./compare-best";

describe("bestOf", () => {
  const plan = (p: Partial<RoutePlan>) =>
    ({
      feasible: true,
      totalMinutes: 0,
      chargeMinutes: 0,
      stops: [],
      arrivalSoc: 0,
      energyKwh: 0,
      ...p,
    }) as RoutePlan;

  it("el menor tiempo gana; la batería al llegar, la mayor", () => {
    const plans = [
      plan({ totalMinutes: 150, arrivalSoc: 12 }),
      plan({ totalMinutes: 140, arrivalSoc: 20 }),
    ];
    expect(bestOf(plans, "totalMinutes")).toEqual([1]);
    expect(bestOf(plans, "arrivalSoc")).toEqual([1]);
  });

  it("solo entre los que llegan, y con empates incluidos", () => {
    const plans = [
      plan({ totalMinutes: 100, feasible: false }),
      plan({ totalMinutes: 140 }),
      plan({ totalMinutes: 140.3 }),
      null,
      plan({ totalMinutes: 160 }),
    ];
    expect(bestOf(plans, "totalMinutes")).toEqual([1, 2]);
  });

  it("sin nada que destacar: menos de dos llegan o todos empatan", () => {
    expect(bestOf([plan({ stops: [] }), plan({ feasible: false })], "stops")).toEqual([]);
    expect(
      bestOf([plan({ chargeMinutes: 10 }), plan({ chargeMinutes: 10.2 })], "chargeMinutes"),
    ).toEqual([]);
  });
});
