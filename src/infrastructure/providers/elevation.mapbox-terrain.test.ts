import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePng, terrainRgb } from "@/test-support/png-encoder";
import {
  clearTerrainMemory,
  mapboxTileFetcher,
  terrainElevations,
  terrainRgbHeight,
  tileBorder,
  tileCoords,
} from "./elevation.mapbox-terrain";
import type { DecodedPng } from "./png";

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

describe("Terrain-DEM v1: tesela con borde de 1 px (514 = 512 + 2)", () => {
  it("tileBorder: solo lo que sobra sobre la potencia de 2", () => {
    expect(tileBorder(256)).toBe(0);
    expect(tileBorder(512)).toBe(0);
    expect(tileBorder(514)).toBe(1);
    expect(tileBorder(258)).toBe(1);
    expect(tileBorder(300)).toBe(0);
  });

  /** 514×514 ya decodificada: la columna c (1..512 es contenido) vale 1000 + 20·(c − 1) m. */
  function borderedTile(): DecodedPng {
    const size = 514;
    const data = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) data.set(terrainRgb(1000 + 20 * (x - 1)), (y * size + x) * 3);
    return { width: size, height: size, channels: 3, data };
  }

  it("descuenta el borde al ubicar el punto y usa el decodificador inyectado", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchTile = vi.fn(async () => bytes);
    const decode = vi.fn(() => borderedTile());
    const z = 12;
    const base = tileCoords({ lat: 7.1, lon: -73.1 }, z, 256);
    // Centro del píxel 400 del contenido (de 512).
    const lon = ((base.x + 400.5 / 512) / 4096) * 360 - 180;
    const [h] = await terrainElevations([{ lat: 7.1, lon }], {
      zoom: z,
      tileset: "mapbox.mapbox-terrain-dem-v1",
      fetchTile,
      decode,
    });
    // Sin descontar el borde daría ~9011 m.
    expect(h).toBeCloseTo(9000, 3);
    expect(decode).toHaveBeenCalledWith(bytes);
  });

  it("la caché en memoria separa variantes del mismo tileset (cacheId)", async () => {
    const fetchTile = vi.fn(async () => rampTile());
    const pts = [{ lat: 7.1, lon: -73.1 }];
    await terrainElevations(pts, { zoom: 12, tileset: "t", fetchTile, cacheId: "t" });
    await terrainElevations(pts, { zoom: 12, tileset: "t", fetchTile, cacheId: "t@2x" });
    await terrainElevations(pts, { zoom: 12, tileset: "t", fetchTile, cacheId: "t@2x" });
    expect(fetchTile).toHaveBeenCalledTimes(2);
  });
});

describe("mapboxTileFetcher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("@2x pide la tesela de 512 px por la misma API, con otra clave de caché", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(String(input));
      return new Response(new Uint8Array([9, 9]), { status: 200 });
    });
    const one = await mapboxTileFetcher("tok")("mapbox.terrain-rgb", 12, 1, 2);
    const two = await mapboxTileFetcher("tok", { retina: true })("mapbox.terrain-rgb", 11, 1, 2);
    expect([...one]).toEqual([9, 9]);
    expect([...two]).toEqual([9, 9]);
    expect(urls).toEqual([
      "https://api.mapbox.com/v4/mapbox.terrain-rgb/12/1/2.pngraw?access_token=tok",
      "https://api.mapbox.com/v4/mapbox.terrain-rgb/11/1/2@2x.pngraw?access_token=tok",
    ]);
  });
});

describe("caché en memoria por píxeles", () => {
  const blank = (size: number): DecodedPng => ({
    width: size,
    height: size,
    channels: 3,
    data: new Uint8Array(size * size * 3),
  });
  /** Un punto en la tesela x (zoom 12, misma fila). */
  const inTile = (x: number) => ({ lat: 7.1, lon: ((x + 0.5) / 4096) * 360 - 180 });

  async function load(size: number, tiles: number) {
    const fetchTile = vi.fn(async () => new Uint8Array([1]));
    const opts = { zoom: 12, tileset: "t", fetchTile, decode: () => blank(size) };
    for (let x = 0; x < tiles; x++) await terrainElevations([inTile(1000 + x)], opts);
    fetchTile.mockClear();
    await terrainElevations([inTile(1000)], opts);
    return fetchTile.mock.calls.length;
  }

  it("con teselas de 256 px guarda 96: la primera de 25 sigue en memoria", async () => {
    expect(await load(256, 25)).toBe(0);
  });

  it("con teselas de 512 px guarda 24: la primera de 25 se vuelve a pedir", async () => {
    expect(await load(512, 25)).toBe(1);
  });
});
