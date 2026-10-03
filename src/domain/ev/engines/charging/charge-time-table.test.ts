import { describe, expect, it } from "vitest";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { DEFAULT_CURVE, FLAT_CURVE, chargeTimeMinutes, chargeTimeTable } from "./curve";

/** Tabla única de tiempos de carga (M4.2, ADR-0026). */
const params = MODEL_PARAMETERS.charging;
const CAP = 60;
const table = (over: Partial<Parameters<typeof chargeTimeTable>[0]> = {}) =>
  chargeTimeTable({
    capacityKwh: CAP,
    peakKw: 120,
    curve: DEFAULT_CURVE,
    plugKw: 50,
    efficiency: 1,
    params,
    ...over,
  });

describe("chargeTimeTable", () => {
  it("minutes = carga acumulada entre los dos SOC + los minutos fijos; 0 si no carga", () => {
    const t = table();
    expect(t.minutes(20, 80)).toBeCloseTo(t.at(80) - t.at(20) + params.connectionOverheadMin.value, 12);
    expect(t.chargingMinutes(20, 80)).toBeCloseTo(t.at(80) - t.at(20), 12);
    expect(t.minutes(50, 50)).toBe(0);
    expect(t.minutes(60, 40)).toBe(0);
    expect(t.overheadMin).toBe(params.connectionOverheadMin.value);
  });

  it("la carga es aditiva y creciente: cargar de A a C = de A a B + de B a C", () => {
    const t = table();
    expect(t.chargingMinutes(10, 90)).toBeCloseTo(t.chargingMinutes(10, 55) + t.chargingMinutes(55, 90), 12);
    for (let soc = 0; soc < 100; soc += 5) expect(t.at(soc + 5)).toBeGreaterThan(t.at(soc));
  });

  it("coincide con chargeTimeMinutes (el cálculo de las fichas) salvo la alineación de la malla", () => {
    const t = table();
    for (const [from, to] of [[10, 80], [20, 60], [35, 90], [5, 100]] as const) {
      const legacy = chargeTimeMinutes(CAP, from, to, 120, 50, DEFAULT_CURVE);
      expect(Math.abs(t.minutes(from, to) - legacy) / legacy, `${from}→${to}`).toBeLessThan(0.01);
    }
  });

  it("socAfter es la inversa de la carga: cargar `min` minutos desde `from` llega a `to` con at(to) − at(from) = min", () => {
    const t = table();
    for (const from of [5, 20, 47.3, 70]) {
      for (const min of [3, 10, 25]) {
        const to = t.socAfter(from, t.at(from), min);
        if (to >= 100) continue;
        expect(t.at(to) - t.at(from)).toBeCloseTo(min, 6);
      }
    }
    expect(t.socAfter(30, t.at(30), 0)).toBe(30);
    expect(t.socAfter(30, t.at(30), 10_000)).toBe(100);
  });

  describe("pérdidas de carga", () => {
    it("AC: la batería recibe `eficiencia` de lo que da la toma, así que tarda 1/eficiencia más", () => {
      const ac = (efficiency: number) =>
        table({ peakKw: 11, curve: FLAT_CURVE, plugKw: 11, efficiency }).chargingMinutes(20, 80);
      expect(ac(0.88) / ac(1)).toBeCloseTo(1 / 0.88, 9);
    });

    it("DC limitada por la estación: tarda 1/eficiencia más", () => {
      const dc = (efficiency: number) => table({ plugKw: 22, efficiency }).chargingMinutes(20, 60);
      expect(dc(0.95) / dc(1)).toBeCloseTo(1 / 0.95, 9);
    });

    it("DC limitada por el vehículo (su curva es de la batería): las pérdidas no la frenan más", () => {
      // Estación de 350 kW con un vehículo de 120 kW: manda la curva del vehículo.
      const dc = (efficiency: number) => table({ plugKw: 350, efficiency }).chargingMinutes(20, 60);
      expect(dc(0.95)).toBeCloseTo(dc(1), 9);
    });

    it("sin pérdidas (1) es la tabla de siempre", () => {
      const a = table({ efficiency: 1 });
      const b = table({ efficiency: 1 });
      expect(a.minutes(15, 85)).toBe(b.minutes(15, 85));
    });
  });
});
