import { describe, expect, it } from "vitest";
import type { ConsolidatedStation } from "@/domain/stations/model";
import { catalogVehicle } from "@/test-support/scenarios";
import { syntheticStations } from "@/test-support/synthetic-providers";
import { formatStationFunnel, stationFunnel } from "./station-funnel";

const vehicle = catalogVehicle("mg-s5-ev-comfort");
const [a, b, c] = syntheticStations().stations as [
  ConsolidatedStation,
  ConsolidatedStation,
  ConsolidatedStation,
];

describe("stationFunnel", () => {
  it("cuenta cuántas sobreviven a cada filtro y dice por qué se cayó cada una", () => {
    const offline: ConsolidatedStation = { ...a, id: "off", availability: { value: "offline" } };
    const ineligible: ConsolidatedStation = {
      ...b,
      id: "bad",
      planning: { eligible: false, reasons: ["Coordenadas inválidas"] },
    };
    const chademoOnly: ConsolidatedStation = {
      ...c,
      id: "cha",
      connectors: c.connectors.map((k) => ({ ...k, standard: "chademo" as const, rawLabel: "CHAdeMO" })),
    };
    const unapproved: ConsolidatedStation = { ...a, id: "com", coordSource: "community" };
    const f = stationFunnel(40, [a, offline, ineligible, chademoOnly, unapproved], vehicle);
    expect(f).toMatchObject({
      listed: 40,
      corridor: 5,
      eligible: 4,
      verified: 3,
      compatible: 2,
      inService: 1,
    });
    expect(f.usable.map((u) => u.id)).toEqual([a.id]);
    expect(f.discarded.map((d) => [d.id, d.reason])).toEqual([
      ["bad", "no elegible: Coordenadas inválidas (conectores: type2→type2)"],
      ["com", 'no verificada para planificar (fuente "community")'],
      ["cha", "sin conector compatible (tiene CHAdeMO→chademo)"],
      ["off", "fuera de servicio"],
    ]);
    const text = formatStationFunnel(f, "blaze", "MG S5 EV", 12);
    expect(text).toMatch(
      /^\[plan-trip:stations\] blaze: 40 en el listado → 5 a ≤ 12 km de la ruta → 4 elegibles/,
    );
    expect(text).toContain("para planificar:");
    expect(text).toContain("descartadas: bad");
  });
});
