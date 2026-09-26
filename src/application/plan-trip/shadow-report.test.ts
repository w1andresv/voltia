import { describe, expect, it } from "vitest";
import { formatShadowReport, type ShadowPlanSide, type ShadowReport } from "./shadow-report";

const legacy: ShadowPlanSide = {
  feasible: true,
  stops: [{ name: "EDS Terpel Curití", arriveSoc: 32.3, departSoc: 61.5, minutes: 19 }],
  totalMinutes: 250,
  arrivalSoc: 18.9,
  minSoc: 18.9,
};

function report(
  v2: ShadowPlanSide,
  selected: [string, string] = ["route-0", "route-0"],
): ShadowReport {
  return {
    trip: "Piedecuesta → Vélez",
    mode: "fastest",
    ms: 12,
    selected,
    routes: [
      { id: "route-0", label: "Ruta A", legacy, v2, v2Status: "FEASIBLE_ONE_STOP" },
      { id: "route-1", label: "Ruta B", legacy, v2: legacy, v2Status: "FEASIBLE_ONE_STOP" },
    ],
  };
}

describe("formatShadowReport", () => {
  it("muestra cada ruta como actual → v2 con las diferencias y las paradas", () => {
    const text = formatShadowReport(
      report({
        ...legacy,
        stops: [{ ...legacy.stops[0]!, departSoc: 58, minutes: 17 }],
        totalMinutes: 246,
        arrivalSoc: 15.5,
        minSoc: 15.5,
      }),
    );
    expect(text).toContain("[plan-trip:shadow] Piedecuesta → Vélez · más rápida · v2 en 12 ms");
    expect(text).toContain("Elegida: actual Ruta A · v2 Ruta A");
    expect(text).toMatch(/Tiempo\s+4h10\s+→ 4h06\s+−4 min/);
    expect(text).toMatch(/Llega con\s+18,9 %\s+→ 15,5 %\s+−3,4 pts/);
    expect(text).toContain("Actual: EDS Terpel Curití (32,3 %→61,5 %, 19 min)");
    expect(text).toContain("v2:     EDS Terpel Curití (32,3 %→58 %, 17 min)");
    expect(text).toContain("Ruta B  (sin diferencias)");
  });

  it("marca cuando cada planificador elige una ruta distinta, y la carga antes de salir", () => {
    const text = formatShadowReport(
      report({ ...legacy, preChargePct: 12, stops: [] }, ["route-0", "route-1"]),
    );
    expect(text).toContain("Elegida: actual Ruta A · v2 Ruta B  ← distinta");
    expect(text).toContain("v2:     cargar +12 % antes · sin paradas");
  });

  it("indica los planes no viables", () => {
    const text = formatShadowReport(report({ ...legacy, feasible: false, stops: [] }));
    expect(text).toMatch(/Viable\s+sí\s+→ no/);
    expect(text).toContain("v2:     no viable");
  });
});
