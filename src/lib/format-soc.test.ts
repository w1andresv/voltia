import { describe, expect, it } from "vitest";
import { formatSoc } from "./format";

describe("formatSoc", () => {
  it("un SOC negativo se muestra como 'Sin batería', no como −25 %", () => {
    expect(formatSoc(-25.7)).toBe("Sin batería");
    expect(formatSoc(15.5)).toMatch(/^16\s%$/);
    expect(formatSoc(0)).toMatch(/^0\s%$/);
  });
});
