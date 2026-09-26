import { describe, expect, it } from "vitest";
import { classifyFeasibility, type FeasibilityInput } from "./engine";

const base: FeasibilityInput = {
  feasibleNow: true,
  stops: 0,
  feasibleWithPrecharge: false,
  compatibleStations: 3,
  destinationShort: false,
  validated: true,
};

describe("classifyFeasibility: los cinco estados", () => {
  it("FEASIBLE_NO_CHARGING, ONE_STOP y MULTIPLE_STOPS", () => {
    expect(classifyFeasibility(base)).toEqual({ feasible: true, status: "FEASIBLE_NO_CHARGING" });
    expect(classifyFeasibility({ ...base, stops: 1 }).status).toBe("FEASIBLE_ONE_STOP");
    expect(classifyFeasibility({ ...base, stops: 3 }).status).toBe("FEASIBLE_MULTIPLE_STOPS");
  });

  it("INFEASIBLE_WITH_CURRENT_SOC: viable cargando antes de salir", () => {
    expect(classifyFeasibility({ ...base, feasibleNow: false, feasibleWithPrecharge: true })).toEqual({
      feasible: true,
      status: "INFEASIBLE_WITH_CURRENT_SOC",
      reasonCode: "INITIAL_SOC_INSUFFICIENT",
    });
  });

  it("INFEASIBLE_EVEN_AT_FULL_SOC con su motivo", () => {
    const no = { ...base, feasibleNow: false };
    expect(classifyFeasibility({ ...no, compatibleStations: 0 }).reasonCode).toBe("NO_COMPATIBLE_STATIONS_IN_CORRIDOR");
    expect(classifyFeasibility({ ...no, destinationShort: true }).reasonCode).toBe("DESTINATION_RESERVE_UNREACHABLE");
    expect(classifyFeasibility(no)).toEqual({
      feasible: false,
      status: "INFEASIBLE_EVEN_AT_FULL_SOC",
      reasonCode: "GAP_BETWEEN_STATIONS_EXCEEDS_RANGE",
    });
  });

  it("si la verificación final falla, no es viable", () => {
    expect(classifyFeasibility({ ...base, stops: 1, validated: false }).reasonCode).toBe("PLAN_VALIDATION_FAILED");
  });
});
