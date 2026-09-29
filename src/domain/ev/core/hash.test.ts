import { describe, expect, it } from "vitest";
import { stableHash } from "./hash";

describe("stableHash", () => {
  it("no depende del orden de las claves", () => {
    expect(stableHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });

  it("cambia con el contenido y tiene 14 caracteres hexadecimales", () => {
    const h = stableHash({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{14}$/);
    expect(stableHash({ a: 2 })).not.toBe(h);
    expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]));
  });
});
