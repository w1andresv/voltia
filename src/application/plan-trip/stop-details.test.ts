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
