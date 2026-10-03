import { describe, expect, it } from "vitest";
import { energyProfileForRoute } from "../ev/energy-v2";
import { MODEL_PARAMETERS, type ModelParameters } from "../ev/core/params";
import { withEnergyMargin } from "../ev/engines/soc/margin";
import { simulateSoc } from "../ev/engines/soc/simulate";
import { catalogVehicle } from "@/test-support/scenarios";
import {
  BENCH_CONDITIONS,
  BENCH_DESTINATION,
  BENCH_ORIGIN,
  benchChargers,
  benchRoute,
} from "@/test-support/planner-scenarios";
import { buildPlan } from "../planner";
import { stopEvents } from "./shared";

/** Margen de energía (M2.3, ADR-0023): se planifica con un gasto algo mayor; la curva mostrada es la nominal. */
const raw = benchRoute();
const vehicle = catalogVehicle("mg-s5-ev-comfort");
const chargers = benchChargers(raw, 25, false);

function plan(params?: ModelParameters) {
  return buildPlan({
    raw,
    vehicle,
    conditions: BENCH_CONDITIONS,
    chargers,
    weather: null,
    origin: BENCH_ORIGIN,
    destination: BENCH_DESTINATION,
    engine: "v2",
    energyEngine: "v2",
    ...(params ? { params } : {}),
  });
}
const withMargin = (pct: number): ModelParameters => ({
  ...MODEL_PARAMETERS,
  planning: { ...MODEL_PARAMETERS.planning, energyMarginPercent: pct },
});

describe("margen de energía en el planificador v2", () => {
  it("con 0 (el valor por defecto) el plan es idéntico", () => {
    expect(MODEL_PARAMETERS.planning.energyMarginPercent).toBe(0);
    const a = plan();
    const b = plan(withMargin(0));
    expect(b.stops.map((s) => [s.charger.id, s.arriveSoc, s.departSoc])).toEqual(
      a.stops.map((s) => [s.charger.id, s.arriveSoc, s.departSoc]),
    );
    expect(b.totalMinutes).toBe(a.totalMinutes);
  });

  it("con 10 % nunca hay menos paradas y el plan aguanta un gasto 10 % mayor sin pasar del piso", () => {
    const base = plan();
    const safe = plan(withMargin(10));
    expect(safe.feasible).toBe(true);
    expect(safe.stops.length).toBeGreaterThanOrEqual(base.stops.length);
    expect(safe.chargeMinutes).toBeGreaterThanOrEqual(base.chargeMinutes - 1e-9);

    // El gasto real sale 10 % mayor que el calculado: se simula el plan con esa energía.
    const energy = energyProfileForRoute(raw, vehicle, BENCH_CONDITIONS, null).samples;
    const heavier = withEnergyMargin(energy, 10);
    const sim = simulateSoc(heavier, {
      initialSocPct: safe.initialSoc,
      capacityKwh: vehicle.batteryKwh,
      events: stopEvents(heavier, safe.stops),
      regen: MODEL_PARAMETERS.soc.regenAcceptance,
    });
    const floor = safe.belowMargin?.floorPct ?? safe.safetyPct;
    expect(sim.minSoc).toBeGreaterThanOrEqual(floor - 0.01);
    expect(sim.arrivalSoc).toBeGreaterThanOrEqual(floor - 0.01);
  });

  it("la curva que ve el usuario es la nominal: llega con más batería de la que pide el piso", () => {
    const safe = plan(withMargin(10));
    const nominal = safe.arrivalSoc;
    expect(nominal).toBeGreaterThan((safe.belowMargin?.floorPct ?? safe.safetyPct) + 1);
  });
});
