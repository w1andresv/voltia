import { describe, expect, it } from "vitest";
import type { EnergySample } from "@/domain/ev/contracts/energy";
import { legSoc, regenAcceptance, requiredStartSoc, simulateSoc } from "./simulate";

const CAP = 50; // kWh: 1 kWh = 2 puntos de SOC

/** Perfil por tramos: [gross, regen potencial] por muestra; la primera muestra no gasta. */
function profile(steps: [number, number][]): EnergySample[] {
  let cum = 0;
  const out: EnergySample[] = [
    { km: 0, lat: 7, lon: -73, elevM: 0, slopePct: 0, speedKmh: 60, energyKwh: 0, energyGrossKwh: 0, energyRegenKwh: 0, cumulativeKwh: 0, avgKwhPer100: 0 },
  ];
  steps.forEach(([gross, regen], i) => {
    cum += gross - regen;
    out.push({
      km: i + 1,
      lat: 7 - (i + 1) * 0.009,
      lon: -73,
      elevM: 0,
      slopePct: 0,
      speedKmh: 60,
      energyKwh: gross - regen,
      energyGrossKwh: gross,
      energyRegenKwh: regen,
      cumulativeKwh: cum,
      avgKwhPer100: 0,
    });
  });
  return out;
}

describe("regenAcceptance", () => {
  it("completa hasta 80 %, en línea hasta 0 en 98 %", () => {
    expect(regenAcceptance(50)).toBe(1);
    expect(regenAcceptance(80)).toBe(1);
    expect(regenAcceptance(89)).toBeCloseTo(0.5, 12);
    expect(regenAcceptance(98)).toBe(0);
    expect(regenAcceptance(100)).toBe(0);
  });
});

describe("simulateSoc", () => {
  it("sin regeneración, cada kWh resta 100/capacidad puntos", () => {
    const sim = simulateSoc(profile([[1, 0], [2, 0]]), { initialSocPct: 50, capacityKwh: CAP });
    expect(sim.samples.map((s) => s.soc)).toEqual([50, 48, 44]);
    expect(sim.arrivalSoc).toBe(44);
    expect(sim.minSoc).toBe(44);
    expect(sim.curtailedRegenKwh).toBe(0);
  });

  it("con la batería casi llena recorta la regeneración (C6)", () => {
    const descent = profile([[0.1, 1]]); // bajada: gana carga
    const low = simulateSoc(descent, { initialSocPct: 60, capacityKwh: CAP });
    const high = simulateSoc(descent, { initialSocPct: 89, capacityKwh: CAP });
    const full = simulateSoc(descent, { initialSocPct: 99, capacityKwh: CAP });
    expect(low.samples[1]!.energyRegenKwh).toBe(1);
    expect(high.samples[1]!.energyRegenKwh).toBeCloseTo(0.5, 12);
    expect(high.curtailedRegenKwh).toBeCloseTo(0.5, 12);
    expect(full.samples[1]!.energyRegenKwh).toBe(0);
    expect(full.arrivalSoc).toBeCloseTo(99 - 0.2, 12);
  });

  it("no recorta en 0: el déficit se mide", () => {
    const sim = simulateSoc(profile([[5, 0], [5, 0]]), { initialSocPct: 10, capacityKwh: CAP });
    expect(sim.arrivalSoc).toBe(-10);
    expect(sim.minSoc).toBe(-10);
    expect(sim.minIndex).toBe(2);
    expect(sim.maxDeficitKwh).toBeCloseTo(5, 12);
  });

  it("cargas y desvíos como eventos; el mínimo se mide al llegar al cargador, antes de cargar", () => {
    const sim = simulateSoc(profile([[5, 0], [5, 0], [5, 0]]), {
      initialSocPct: 40,
      capacityKwh: CAP,
      events: [
        { atIndex: 2, energyKwh: 10 },
        { atIndex: 2, energyKwh: -1 },
      ],
    });
    // Llega con 20 %, el desvío deja 18 % (mínimo) y la carga sube a 38 %.
    expect(sim.minSoc).toBe(18);
    expect(sim.samples[2]!.soc).toBe(38);
    expect(sim.arrivalSoc).toBe(28);
  });

  it("el acumulado y la energía por tramo son los aceptados", () => {
    const sim = simulateSoc(profile([[1, 0], [0.1, 1]]), { initialSocPct: 95, capacityKwh: CAP });
    const accepted = sim.samples[2]!.energyRegenKwh;
    expect(accepted).toBeLessThan(1);
    expect(sim.samples[2]!.energyKwh).toBeCloseTo(0.1 - accepted, 12);
    expect(sim.samples[2]!.cumulativeKwh).toBeCloseTo(1 + 0.1 - accepted, 12);
  });
});

describe("legSoc y requiredStartSoc", () => {
  it("legSoc da la llegada y el punto más bajo del tramo", () => {
    // Sube (gasta 10 kWh) y baja (recupera 5): el mínimo está en la cima.
    const p = profile([[10, 0], [0, 5]]);
    const leg = legSoc(p, 0, 2, 50, CAP);
    expect(leg.lowestSoc).toBe(30);
    expect(leg.endSoc).toBe(40);
  });

  it("sin recorte, requiredStartSoc es la cuenta directa", () => {
    const p = profile([[10, 0], [0, 5]]);
    // Llegar con 10 % y no bajar de 10 % en la cima: manda la cima (10 + 20 = 30).
    expect(requiredStartSoc(p, 0, 2, CAP, { arrivalTargetPct: 10, floorPct: 10, extraKwh: 0, tolerancePct: 1e-6 })).toBe(30);
    // Con un desvío de 2 kWh al llegar: 10 + (5 + 2) · 2 = 24; la cima sigue mandando.
    expect(requiredStartSoc(p, 0, 2, CAP, { arrivalTargetPct: 10, floorPct: 0, extraKwh: 2, tolerancePct: 1e-6 })).toBe(24);
  });

  it("con la batería casi llena al empezar una bajada, pide más de la cuenta directa", () => {
    // Baja primero (recupera 3) y luego gasta 20: saliendo alto, la batería no acepta la bajada.
    const p = profile([[0, 3], [20, 0]]);
    const direct = 50 + ((20 - 3) / CAP) * 100; // 84
    const need = requiredStartSoc(p, 0, 2, CAP, { arrivalTargetPct: 50, floorPct: 0, extraKwh: 0, tolerancePct: 1e-6 });
    expect(need).toBeGreaterThan(direct);
    const leg = legSoc(p, 0, 2, need, CAP);
    expect(leg.endSoc).toBeGreaterThanOrEqual(50 - 1e-6);
  });

  it("si ni al 100 % alcanza, devuelve más de 100", () => {
    const p = profile([[60, 0]]);
    expect(requiredStartSoc(p, 0, 1, CAP, { arrivalTargetPct: 10, floorPct: 10, extraKwh: 0, tolerancePct: 1e-6 })).toBeGreaterThan(100);
  });
});
