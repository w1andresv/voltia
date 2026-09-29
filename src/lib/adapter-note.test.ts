import { describe, expect, it } from "vitest";
import type { ConnectorType } from "@/domain/types";
import { adapterNote, adapterRequirementNote } from "./adapter-note";

describe("adapterNote", () => {
  it("no lo lleva: lo indica y aclara que el plan no cuenta con esa opción", () => {
    const n = adapterNote({
      from: "gb_t",
      to: "ccs2",
      carried: false,
      withAdapter: { chargeKw: 50, chargeMinutes: 25 },
      withoutAdapter: { mode: "ac", chargeKw: 11, chargeMinutes: 110 },
    });
    expect(n.title).toBe("Carga rápida con adaptador GB/T → CCS2 (no marcaste que lo llevas)");
    expect(n.withLine).toContain("Con adaptador:");
    expect(n.withLine).toContain("el plan no cuenta con esta opción");
    expect(n.withoutLine).toContain("carga lenta");
  });

  it("lo lleva y no hay otra toma", () => {
    const n = adapterNote({
      from: "ccs1",
      to: "ccs2",
      carried: true,
      withAdapter: { chargeKw: 40, chargeMinutes: 30 },
      withoutAdapter: null,
    });
    expect(n.title).toBe("Requiere adaptador CCS1 → CCS2 (lo llevas)");
    expect(n.withLine).not.toContain("no cuenta");
    expect(n.withoutLine).toBe("Sin adaptador: esta estación no tiene otra toma para tu vehículo");
  });
});

describe("adapterRequirementNote", () => {
  const car = { name: "BYD Dolphin", connectors: ["ccs2", "type2"] as ConnectorType[] };
  const gbt = { from: "gb_t", to: "ccs2" } as const;

  it("no lo lleva: dice cuál requiere y que lo marque", () => {
    const n = adapterRequirementNote(
      { station: ["gb_t"], adapter: gbt, carried: false, fastCharge: true },
      car,
    );
    expect(n).toBe(
      "Requiere adaptador GB/T → CCS2. Si lo llevas, márcalo en tu vehículo y la ruta contará con esta estación.",
    );
  });

  it("lo lleva", () => {
    const n = adapterRequirementNote(
      { station: ["gb_t"], adapter: gbt, carried: true, fastCharge: true },
      car,
    );
    expect(n).toBe("Requiere adaptador GB/T → CCS2 (lo llevas).");
  });

  it("toma sin carga rápida confirmada", () => {
    const n = adapterRequirementNote(
      { station: ["gb_t"], adapter: gbt, carried: true, fastCharge: false },
      car,
    );
    expect(n).toContain("Requiere adaptador GB/T → CCS2, pero la fuente no confirma");
  });

  it("sin adaptador verificado: requiere adaptador y dice qué tiene cada uno", () => {
    const n = adapterRequirementNote(
      { station: ["type1"], adapter: null, carried: false, fastCharge: false },
      car,
    );
    expect(n).toBe(
      "Requiere adaptador para BYD Dolphin: la estación tiene Tipo 1 y el vehículo usa CCS2, Tipo 2.",
    );
  });
});
