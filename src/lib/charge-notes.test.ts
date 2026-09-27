import { describe, expect, it } from "vitest";
import { slowTailNoteForCap, slowTailNoteForStop } from "./charge-notes";

describe("avisos de la zona lenta de carga", () => {
  it("con el tope en ruta sobre el 85 % avisa que el último 10–15 % tarda más", () => {
    expect(slowTailNoteForCap(80)).toBeNull();
    expect(slowTailNoteForCap(85)).toBeNull();
    expect(slowTailNoteForCap(100)).toMatch(
      /^Tope en 100 %\. Por lo general, el último 10–15 % hasta el 100 % tarda más/,
    );
  });

  it("en una parada, solo si la carga pasa del 85 %", () => {
    expect(slowTailNoteForStop(80)).toBeNull();
    expect(slowTailNoteForStop(85.3)).toBeNull();
    expect(slowTailNoteForStop(95)).toMatch(/pasa del 85 %/);
  });
});
