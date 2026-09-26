import type { LatLon } from "@/domain/types";
import { CACHE_FOREVER, fetchBytes } from "./http";
import { decodePng, type DecodedPng } from "./png";

/**
 * Elevación desde las teselas de terreno de Mapbox (terrain-RGB): altura =
 * −10000 + (R·65536 + G·256 + B) × 0,1 m. Se descargan solo las teselas que
 * tocan los puntos pedidos y se guardan en la Data Cache de Next sin
 * vencimiento (el terreno no cambia; compartida por todos los usuarios y entre
 * despliegues) y en memoria (las últimas `MEMORY_TILES`), así rutas
 * repetidas o cercanas no vuelven a pedirlas.
 */

/** El terreno no cambia: las teselas se guardan sin vencimiento. */
const TILE_TTL_MS = CACHE_FOREVER;
const MEMORY_TILES = 96;
const CONCURRENCY = 6;

export function terrainRgbHeight(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/** Coordenadas de tesela (x, y) y posición dentro de ella (px, py, en píxeles) para un punto. */
export function tileCoords(p: LatLon, zoom: number, size: number) {
  const n = 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
  const xf = ((p.lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.floor(xf));
  const y = Math.min(n - 1, Math.floor(yf));
  return { x, y, px: (xf - x) * size, py: (yf - y) * size };
}

/** Altura bilineal en la posición (px, py) de una tesela decodificada. */
export function sampleTile(tile: DecodedPng, px: number, py: number): number {
  const at = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(tile.width - 1, x));
    const cy = Math.max(0, Math.min(tile.height - 1, y));
    const i = (cy * tile.width + cx) * tile.channels;
    return terrainRgbHeight(tile.data[i]!, tile.data[i + 1]!, tile.data[i + 2]!);
  };
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const tx = px - 0.5 - x0;
  const ty = py - 0.5 - y0;
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

const memory = new Map<string, Promise<DecodedPng>>();

function remember(key: string, tile: Promise<DecodedPng>): Promise<DecodedPng> {
  memory.set(key, tile);
  tile.catch(() => memory.delete(key));
  while (memory.size > MEMORY_TILES) memory.delete(memory.keys().next().value!);
  return tile;
}

export type TileFetcher = (tileset: string, z: number, x: number, y: number) => Promise<Uint8Array>;

export function mapboxTileFetcher(token: string): TileFetcher {
  return (tileset, z, x, y) =>
    fetchBytes(`https://api.mapbox.com/v4/${tileset}/${z}/${x}/${y}.pngraw?access_token=${token}`, {
      timeoutMs: 10_000,
      cacheTtlMs: TILE_TTL_MS,
      cacheKey: `terrain:${tileset}:${z}/${x}/${y}`,
    });
}

/** Alturas (m) de los puntos pedidos, en el mismo orden. Lanza si alguna tesela no se pudo obtener. */
export async function terrainElevations(
  points: LatLon[],
  opts: { zoom: number; tileset: string; fetchTile: TileFetcher },
): Promise<number[]> {
  const size = 256;
  const where = points.map((p) => tileCoords(p, opts.zoom, size));
  const keys = [...new Set(where.map((w) => `${w.x}/${w.y}`))];
  const tiles = new Map<string, DecodedPng>();
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + CONCURRENCY).map(async (k) => {
        const memKey = `${opts.tileset}:${opts.zoom}/${k}`;
        const [x, y] = k.split("/").map(Number) as [number, number];
        const tile =
          memory.get(memKey) ??
          remember(
            memKey,
            opts.fetchTile(opts.tileset, opts.zoom, x, y).then((bytes) => decodePng(bytes)),
          );
        tiles.set(k, await tile);
      }),
    );
  }
  return where.map((w) => {
    const tile = tiles.get(`${w.x}/${w.y}`)!;
    return sampleTile(tile, (w.px * tile.width) / size, (w.py * tile.height) / size);
  });
}

/** Solo para tests: vacía la caché en memoria. */
export function clearTerrainMemory(): void {
  memory.clear();
}
