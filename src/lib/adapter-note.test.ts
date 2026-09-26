import { describe, expect, it } from "vitest";
import { adapterNote } from "./adapter-note";

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
