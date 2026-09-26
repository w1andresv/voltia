import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodePng, terrainRgb } from "@/test-support/png-encoder";
import {
  clearTerrainMemory,
  terrainElevations,
  terrainRgbHeight,
  tileCoords,
} from "./elevation.mapbox-terrain";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

/** Tesela de 256×256 con altura = 1000 + 2·columna (m): sube hacia el este. */
function rampTile(): Uint8Array {
  const px = new Uint8Array(256 * 256 * 3);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) px.set(terrainRgb(1000 + 2 * x), (y * 256 + x) * 3);
  return encodePng(256, 256, px, { filters: [0, 1, 2, 4] });
}

beforeEach(() => clearTerrainMemory());

describe("terrain-RGB", () => {
  it("decodifica la altura del color", () => {
    expect(terrainRgbHeight(1, 134, 160)).toBeCloseTo(0, 6);
    const [r, g, b] = terrainRgb(2345.6);
    expect(terrainRgbHeight(r, g, b)).toBeCloseTo(2345.6, 6);
  });

  it("ubica un punto en su tesela", () => {
    expect(tileCoords({ lat: 0, lon: 0 }, 0, 256)).toEqual({ x: 0, y: 0, px: 128, py: 128 });
    const t = tileCoords({ lat: 7.1, lon: -73.1 }, 12, 256);
    expect(t.x).toBe(Math.floor(((-73.1 + 180) / 360) * 4096));
    expect(t.px).toBeGreaterThanOrEqual(0);
    expect(t.px).toBeLessThan(256);
  });
});

describe("terrainElevations", () => {
  it("interpola dentro de la tesela y la pide una sola vez", async () => {
    const fetchTile = vi.fn(async () => rampTile());
    const z = 12;
    // Dos puntos en la misma tesela, a distinta longitud.
    const base = tileCoords({ lat: 7.1, lon: -73.1 }, z, 256);
    const lonAt = (px: number) => ((base.x + px / 256) / 4096) * 360 - 180;
    const pts = [
      { lat: 7.1, lon: lonAt(10.5) },
      { lat: 7.1, lon: lonAt(100.5) },
    ];
    const h = await terrainElevations(pts, { zoom: z, tileset: "t", fetchTile });
    expect(h[0]).toBeCloseTo(1020, 3);
    expect(h[1]).toBeCloseTo(1200, 3);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(fetchTile).toHaveBeenCalledWith("t", z, base.x, base.y);

    // Segunda consulta: la tesela ya está en memoria.
    await terrainElevations(pts, { zoom: z, tileset: "t", fetchTile });
    expect(fetchTile).toHaveBeenCalledTimes(1);
  });

  it("si una tesela falla, lanza y no la deja en memoria", async () => {
    const fetchTile = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 401"))
      .mockResolvedValue(rampTile());
    const opts = { zoom: 12, tileset: "t", fetchTile };
    await expect(terrainElevations([{ lat: 7, lon: -73 }], opts)).rejects.toThrow(/401/);
    await expect(terrainElevations([{ lat: 7, lon: -73 }], opts)).resolves.toHaveLength(1);
    expect(fetchTile).toHaveBeenCalledTimes(2);
  });
});
