import { describe, expect, it } from "vitest";
import { zigzagRoute } from "@/test-support/zigzag-route";
import { fineRouteLine } from "./axis";

/** Línea fina de la ruta con el km en el eje de las muestras (M5, ADR-0027). */
describe("fineRouteLine", () => {
  it("si la geometría no es más densa que las muestras, la línea son las muestras", () => {
    const raw = zigzagRoute();
    const sparse = { ...raw, geometry: raw.geometry.slice(0, 3) };
    const line = fineRouteLine(sparse);
    expect(line).toHaveLength(raw.samples.length);
    expect(line.map((p) => p.km)).toEqual(raw.samples.map((s) => s.km));
  });

  it("usa los puntos de la geometría, con el km medido en el eje de las muestras", () => {
    const raw = zigzagRoute();
    const line = fineRouteLine(raw);
    expect(line).toHaveLength(raw.geometry.length);
    expect(line[0]!.km).toBe(0);
    expect(line[line.length - 1]!.km).toBeCloseTo(100, 6);
    // La punta de la herradura (km 50 de la vía) cae en el km 50 de la cuerda.
    expect(line[25]!.km).toBeCloseTo(50, 0);
    // Cada punto conserva su lugar de la vía.
    expect(line[25]!.lon).toBe(raw.geometry[25]!.lon);
  });

  it("el km no retrocede nunca, aunque la vía vaya y vuelva", () => {
    const line = fineRouteLine(zigzagRoute());
    for (let i = 1; i < line.length; i++) expect(line[i]!.km).toBeGreaterThanOrEqual(line[i - 1]!.km);
  });

  it("sigue el eje de las muestras: si sus km están escalados, la línea también", () => {
    const raw = zigzagRoute();
    const scaled = {
      ...raw,
      distanceKm: 110,
      samples: raw.samples.map((s) => ({ ...s, km: s.km * 1.1 })),
    };
    const a = fineRouteLine(raw);
    const b = fineRouteLine(scaled);
    for (let i = 0; i < a.length; i++) expect(b[i]!.km).toBeCloseTo(a[i]!.km * 1.1, 6);
  });
});
