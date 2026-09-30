import { describe, expect, it } from "vitest";
import { slowTailNoteForStop } from "./charge-notes";

describe("avisos de la zona lenta de carga", () => {
  it("en una parada, solo si la carga pasa del 85 %", () => {
    expect(slowTailNoteForStop(80)).toBeNull();
    expect(slowTailNoteForStop(85.3)).toBeNull();
    expect(slowTailNoteForStop(95)).toMatch(/pasa del 85 %/);
  });
});
