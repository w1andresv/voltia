import { describe, expect, it } from "vitest";
import { MODEL_PARAMETERS, type ModelParameters } from "../ev/core/params";
import { catalogVehicle } from "@/test-support/scenarios";
import {
  BENCH_CONDITIONS,
  BENCH_DESTINATION,
  BENCH_ORIGIN,
  benchChargers,
  benchRoute,
} from "@/test-support/planner-scenarios";
import type { Charger } from "../types";
import { buildPlan } from "../planner";

/** Pérdidas de carga y una sola función de tiempo (M4.2, ADR-0026). */
const raw = benchRoute();
const vehicle = catalogVehicle("mg-s5-ev-comfort");

function plan(chargers: Charger[], params?: ModelParameters) {
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
const withEfficiency = (dc: number, ac: number): ModelParameters => ({
  ...MODEL_PARAMETERS,
  charging: {
    ...MODEL_PARAMETERS.charging,
    efficiency: { ...MODEL_PARAMETERS.charging.efficiency, value: { dc, ac } },
  },
});
const chargers = benchChargers(raw, 12, false);

describe("pérdidas de carga en el planificador v2", () => {
  it("los kWh que se pagan son los de la batería ÷ la eficiencia de la toma que se usa", () => {
    const p = plan(chargers);
    expect(p.stops.length).toBeGreaterThan(0);
    const eff = MODEL_PARAMETERS.charging.efficiency.value;
    for (const s of p.stops) {
      const dc = s.chargeKw > 22 || s.bestSocket.connector === "ccs2";
      expect(s.energyFromGridKwh).toBeCloseTo(s.energyAddedKwh / (dc ? eff.dc : eff.ac), 9);
      expect(s.energyFromGridKwh!).toBeGreaterThan(s.energyAddedKwh);
    }
  });

  it("sin pérdidas se paga lo mismo que recibe la batería", () => {
    const p = plan(chargers, withEfficiency(1, 1));
    for (const s of p.stops) expect(s.energyFromGridKwh).toBeCloseTo(s.energyAddedKwh, 12);
  });

  it("con pérdidas la carga tarda más y el plan no es más rápido", () => {
    const lossy = plan(chargers);
    const ideal = plan(chargers, withEfficiency(1, 1));
    expect(lossy.chargeMinutes).toBeGreaterThanOrEqual(ideal.chargeMinutes - 1e-9);
    expect(lossy.totalMinutes).toBeGreaterThanOrEqual(ideal.totalMinutes - 1e-9);
  });

  it("los minutos de cada parada son los mismos que optimizó la programación dinámica y los de sus opciones", () => {
    const p = plan(chargers);
    for (const s of p.stops) {
      const chosen = s.options!.find((o) => o.socket === s.bestSocket && o.chargeKw === s.chargeKw)!;
      expect(s.chargeMinutes).toBe(chosen.chargeMinutes);
      // La alternativa de carga lenta sale de la misma tabla.
      if (s.alternative) {
        const ac = s.options!.find((o) => o.mode === "ac" && o.socket === s.alternative!.socket)!;
        expect(s.alternative.chargeMinutes).toBe(ac.chargeMinutes);
      }
    }
    // Y el total del plan suma exactamente esas paradas.
    expect(p.chargeMinutes).toBeCloseTo(p.stops.reduce((a, s) => a + s.chargeMinutes, 0), 9);
  });

  it("el resumen de adaptadores usa los mismos minutos que la parada (una sola función de tiempo)", () => {
    // Estación con GB/T de carga rápida (el vehículo no lo tiene, necesita adaptador) y Tipo 2:
    // el plan carga en AC, y "sin adaptador" es esa misma carga.
    const gbt = (c: Charger): Charger => ({
      ...c,
      sockets: [
        { connector: "gb_t", powerKw: 60, count: 1, current: "DC", currentOrigin: "reported", powerOrigin: "reported" },
        { connector: "type2", powerKw: 22, count: 1, current: "AC", currentOrigin: "standard", powerOrigin: "reported" },
      ],
    });
    const p = plan(benchChargers(raw, 12, false).map(gbt));
    const withNeed = p.stops.filter((s) => s.adapterNeeded?.withoutAdapter);
    expect(withNeed.length).toBeGreaterThan(0);
    for (const s of withNeed) {
      expect(s.adapterNeeded!.withoutAdapter!.chargeMinutes).toBeCloseTo(s.chargeMinutes, 9);
    }
  });

  it("el plan lo dice en sus supuestos", () => {
    const a = plan(chargers).assumptions?.find((x) => x.parameter === "charging.efficiency");
    expect(a).toMatchObject({ source: "estimated", value: { dc: 0.95, ac: 0.88 } });
  });

  it("el planificador v1 no cambia: no usa las pérdidas", () => {
    const run = (params: ModelParameters) =>
      buildPlan({
        raw,
        vehicle,
        conditions: BENCH_CONDITIONS,
        chargers,
        weather: null,
        origin: BENCH_ORIGIN,
        destination: BENCH_DESTINATION,
        engine: "legacy",
        energyEngine: "legacy",
        params,
      });
    const a = run(MODEL_PARAMETERS);
    const b = run(withEfficiency(1, 1));
    expect(a.totalMinutes).toBe(b.totalMinutes);
    expect(a.stops.every((s) => s.energyFromGridKwh === undefined)).toBe(true);
  });
});
