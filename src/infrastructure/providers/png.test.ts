import { describe, expect, it } from "vitest";
import { encodePng } from "@/test-support/png-encoder";
import { decodePng } from "./png";

function pixels(w: number, h: number, channels: number): Uint8Array {
  return Uint8Array.from({ length: w * h * channels }, (_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
}

describe("decodePng", () => {
  it.each([
    [3, [0]],
    [3, [1]],
    [3, [2]],
    [3, [3]],
    [3, [4]],
    [4, [0, 1, 2, 3, 4]],
  ] as [3 | 4, number[]][])("RGB/RGBA (%i canales) con filtros %j", (channels, filters) => {
    const px = pixels(7, 5, channels);
    const out = decodePng(encodePng(7, 5, px, { channels, filters }));
    expect(out).toMatchObject({ width: 7, height: 5, channels });
    expect([...out.data]).toEqual([...px]);
  });

  it("rechaza lo que no es PNG o un formato no soportado", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/firma/);
    const png = encodePng(2, 2, pixels(2, 2, 3));
    png[8 + 8 + 8] = 16; // bits por canal en el IHDR
    expect(() => decodePng(png)).toThrow(/no soportado/);
  });
});
