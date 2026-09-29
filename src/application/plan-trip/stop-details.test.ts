import { describe, expect, it, vi } from "vitest";
import type { ConsolidatedStation } from "@/domain/stations/model";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import type { RoutePlan } from "@/domain/types";
import { syntheticStations } from "@/test-support/synthetic-providers";
import { checkStopDetails, offlineStopText } from "./stop-details";

const stations = syntheticStations().stations.filter((s) => s.planning.eligible);
const chargers = stations.map(toPlanningCharger);
const plan = {
  stops: [{ charger: chargers[0]! }, { charger: chargers[2]! }],
} as unknown as RoutePlan;

describe("checkStopDetails", () => {
  it("sin cambios en el detalle, nada cambia", async () => {
    const byId = new Map(stations.map((s) => [s.id, s]));
    const check = await checkStopDetails(
      { get: async (id) => byId.get(id) ?? null },
      plan,
      chargers,
    );
    expect(check).toMatchObject({ changed: 0, offline: [], requested: 2, failed: 0 });
    expect(check.chargers).toEqual(chargers);
  });

  it("no vuelve a pedir las estaciones ya consultadas", async () => {
    const byId = new Map(stations.map((s) => [s.id, s]));
    const get = vi.fn(async (id: string) => byId.get(id) ?? null);
    const check = await checkStopDetails(
      { get },
      plan,
      chargers,
      undefined,
      new Set([chargers[0]!.id]),
    );
    expect(get.mock.calls.map(([id]) => id)).toEqual([chargers[2]!.id]);
    expect(check.checkedIds).toEqual([chargers[2]!.id]);
    expect(check.requested).toBe(1);
  });

  it("aplica la potencia real del detalle y marca la estación sin cargadores en servicio", async () => {
    const [a, , b] = stations as [ConsolidatedStation, ConsolidatedStation, ConsolidatedStation];
    const faster: ConsolidatedStation = {
      ...a,
      connectors: a.connectors.map((c) => ({ ...c, powerKw: 180 })),
    };
    const down: ConsolidatedStation = {
      ...b,
      availability: { value: "offline" },
      planning: { eligible: false, reasons: ["Reportada fuera de servicio"] },
    };
    const check = await checkStopDetails(
      { get: async (id) => (id === a.id ? faster : id === b.id ? down : null) },
      plan,
      chargers,
    );
    expect(check.changed).toBe(2);
    expect(check.offline.map((c) => c.id)).toEqual([b.id]);
    expect(check.chargers.find((c) => c.id === a.id)!.sockets[0]!.powerKw).toBe(180);
    expect(check.chargers.find((c) => c.id === b.id)).toMatchObject({
      availability: "offline",
      available: false,
    });
    expect(check.chargers).toHaveLength(chargers.length);
  });

  it("un detalle que no sirve para planificar pero no está fuera de servicio no descarta la estación", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [a] = stations as [ConsolidatedStation];
    // P. ej. el detalle trae los conectores escritos de otra forma ("Tipo2") y no se reconocen.
    const unreadable: ConsolidatedStation = {
      ...a,
      availability: { value: "available" },
      connectors: a.connectors.map((k) => ({
        ...k,
        standard: "other" as const,
        rawLabel: "Tipo2",
      })),
      planning: { eligible: false, reasons: ["Sin conectores compatibles conocidos"] },
    };
    const check = await checkStopDetails(
      { get: async (id) => (id === a.id ? unreadable : null) },
      plan,
      chargers,
    );
    expect(check).toMatchObject({ changed: 0, offline: [] });
    expect(check.chargers).toEqual(chargers);
  });

  it("una consulta que no responde a tiempo cuenta como fallida y no bloquea", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = await checkStopDetails({ get: () => new Promise(() => {}) }, plan, chargers, 20);
    expect(check).toMatchObject({ changed: 0, failed: 2 });
  });

  it("texto del aviso en singular y plural", () => {
    expect(offlineStopText(["A"])).toMatch(/^La estación A figura fuera de servicio/);
    expect(offlineStopText(["A", "B"])).toMatch(/^Las estaciones A, B figuran/);
  });
});
