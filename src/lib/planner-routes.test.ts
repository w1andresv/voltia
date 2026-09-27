import { describe, expect, it } from "vitest";
import { engineOfPath, plannerHref } from "./planner-routes";

describe("planner-routes", () => {
  it("lleva cada motor a su ruta y sin elección al v1", () => {
    expect(plannerHref("v1")).toBe("/v1");
    expect(plannerHref("v2")).toBe("/v2");
    expect(plannerHref(null)).toBe("/v1");
    expect(plannerHref(undefined)).toBe("/v1");
  });

  it("reconoce el motor de la ruta y nada más", () => {
    expect(engineOfPath("/v1")).toBe("v1");
    expect(engineOfPath("/v2")).toBe("v2");
    expect(engineOfPath("/v2/")).toBe("v2");
    expect(engineOfPath("/")).toBeNull();
    expect(engineOfPath("/v10")).toBeNull();
    expect(engineOfPath("/electrolineras")).toBeNull();
  });
});
