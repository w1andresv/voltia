import { describe, expect, it } from "vitest";
import { fakeProviderRoute } from "@/test-support/mapbox-fixtures";
import { tollBoothsKm } from "./classify";
import { toRawRoute } from "./normalize";

/**
 * Peajes (M2.1, ADR-0021). La forma de `tollCollection` es la que documenta Mapbox
 * Directions (`toll_collection: { type: "toll_booth" | "toll_gantry" }` en la intersección);
 * la ruta es sintética: aún no se ha verificado con una respuesta real de Colombia.
 */
function withTolls(marks: { step: number; at: 0 | 1; type: string }[]) {
  // Tres pasos de 20 km: la intersección 0 de cada paso está en su inicio y la 1, a mitad.
  const route = fakeProviderRoute([
    ["primary", 20, 15],
    ["primary", 20, 15],
    ["primary", 20, 15],
  ]);
  for (const m of marks) {
    route.legs[0]!.steps![m.step]!.intersections![m.at]!.tollCollection = { type: m.type };
  }
  return route;
}

describe("tollBoothsKm", () => {
  it("las casetas salen en su km sobre la ruta, en orden", () => {
    const km = tollBoothsKm(
      withTolls([
        { step: 2, at: 1, type: "toll_booth" },
        { step: 0, at: 1, type: "toll_booth" },
      ]),
    );
    expect(km).toHaveLength(2);
    expect(km[0]).toBeCloseTo(10, 0);
    expect(km[1]).toBeCloseTo(50, 0);
  });

  it("un pórtico electrónico no cuenta: el carro no se detiene", () => {
    expect(tollBoothsKm(withTolls([{ step: 1, at: 1, type: "toll_gantry" }]))).toEqual([]);
  });

  it("los carriles de una misma plaza (a menos de 250 m) son una sola caseta", () => {
    const route = withTolls([
      { step: 1, at: 0, type: "toll_booth" },
      // Un segundo carril: la intersección siguiente está a 10 km, así que se simula
      // otra caseta en el mismo punto del paso siguiente.
    ]);
    // Dos intersecciones del mismo punto: se duplica la ubicación de la primera.
    const inters = route.legs[0]!.steps![1]!.intersections!;
    inters.splice(1, 0, { ...inters[0]!, tollCollection: { type: "toll_booth" } });
    expect(tollBoothsKm(route)).toHaveLength(1);
  });

  it("una ruta sin intersecciones de peaje no tiene casetas", () => {
    expect(tollBoothsKm(withTolls([]))).toEqual([]);
  });
});

describe("toRawRoute con casetas", () => {
  it("lleva las casetas al eje de las muestras, sin las pegadas al origen o al destino", () => {
    const route = withTolls([
      { step: 0, at: 0, type: "toll_booth" }, // en el origen
      { step: 1, at: 1, type: "toll_booth" }, // ~30 km
    ]);
    const raw = toRawRoute(route, { id: "r", label: "Ruta" });
    expect(raw.tollBoothsKm).toHaveLength(1);
    expect(raw.tollBoothsKm![0]).toBeCloseTo(30, 0);
    expect(raw.tollBoothsKm![0]!).toBeLessThan(raw.distanceKm);
  });

  it("sin casetas no agrega el campo (los snapshots viejos siguen iguales)", () => {
    const raw = toRawRoute(withTolls([]), { id: "r", label: "Ruta" });
    expect("tollBoothsKm" in raw).toBe(false);
  });
});
