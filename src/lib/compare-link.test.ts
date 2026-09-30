import { describe, expect, it } from "vitest";
import { compareHref, parseCompareIds } from "./compare-link";

describe("enlace de la comparativa", () => {
  it("arma el enlace con uno o dos vehículos", () => {
    expect(compareHref(["tesla-model-3"])).toBe("/comparar?vehiculos=tesla-model-3");
    expect(compareHref(["a", "b", "c"])).toBe("/comparar?vehiculos=a,b");
  });

  it("lee los vehículos: sin repetir, sin el del plan y como mucho dos", () => {
    const param = new URL(`http://x${compareHref(["a", "b"])}`).searchParams.get("vehiculos");
    expect(parseCompareIds(param, "mio")).toEqual(["a", "b"]);
    expect(parseCompareIds("a, a,mio,,b,c", "mio")).toEqual(["a", "b"]);
    expect(parseCompareIds(null, "mio")).toEqual([]);
  });
});
