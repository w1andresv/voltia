import type { LatLon } from "@/domain/types";
import { CACHE_FOREVER, fetchBytes } from "./http";
import { decodePng, type DecodedPng } from "./png";

/**
 * Elevación desde las teselas de terreno de Mapbox. Terrain-RGB v1 y
 * Terrain-DEM v1 codifican igual: altura = −10000 + (R·65536 + G·256 + B) × 0,1 m.
 * Terrain-DEM trae un borde de 1 px por lado (514 = 512 + 2) que se descuenta
 * al ubicar el punto (`tileBorder`). Se descargan solo las teselas que
 * tocan los puntos pedidos y se guardan en la Data Cache de Next sin
 * vencimiento (el terreno no cambia; compartida por todos los usuarios y entre
 * despliegues) y en memoria (las últimas `MEMORY_TILES`), así rutas
 * repetidas o cercanas no vuelven a pedirlas.
 */

/** El terreno no cambia: las teselas se guardan sin vencimiento. */
const TILE_TTL_MS = CACHE_FOREVER;
/**
 * Presupuesto de la caché en memoria, en píxeles: el equivalente a 96 teselas
 * de 256 px (~19 MB en RGB). Con teselas @2x de 512 px caben 24.
 */
const MEMORY_PIXELS = 96 * 256 * 256;
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

const memory = new Map<string, { tile: Promise<DecodedPng>; pixels: number }>();

/** Saca las más viejas hasta caber en el presupuesto; siempre deja la última. */
function evict(): void {
  let total = 0;
  for (const e of memory.values()) total += e.pixels;
  while (memory.size > 1 && total > MEMORY_PIXELS) {
    const oldest = memory.keys().next().value!;
    total -= memory.get(oldest)!.pixels;
    memory.delete(oldest);
  }
}

function remember(key: string, tile: Promise<DecodedPng>): Promise<DecodedPng> {
  const entry = { tile, pixels: 256 * 256 };
  memory.set(key, entry);
  tile.then(
    (t) => {
      entry.pixels = t.width * t.height;
      evict();
    },
    () => memory.delete(key),
  );
  evict();
  return tile;
}

export type TileFetcher = (tileset: string, z: number, x: number, y: number) => Promise<Uint8Array>;

/** De bytes a píxeles. Por defecto PNG (`decodePng`); se inyecta otro para WebP. */
export type TileDecoder = (bytes: Uint8Array) => DecodedPng | Promise<DecodedPng>;

/**
 * Píxeles de borde por lado: los que sobran sobre la potencia de 2 (514 → 1,
 * 258 → 1, 256 y 512 → 0). Terrain-DEM los trae para interpolar entre teselas.
 */
export function tileBorder(size: number): number {
  const base = 2 ** Math.floor(Math.log2(size));
  const border = (size - base) / 2;
  return Number.isInteger(border) && border <= 4 ? border : 0;
}

export interface MapboxTileOptions {
  /** @2x: teselas de 512 px en vez de 256, el doble de resolución en cada consulta. */
  retina?: boolean;
}

/** Raster Tiles API v4 (`.pngraw`, el formato sin pérdida que Mapbox pide para terreno). */
export function mapboxTileFetcher(token: string, options: MapboxTileOptions = {}): TileFetcher {
  const scale = options.retina ? "@2x" : "";
  return (tileset, z, x, y) =>
    fetchBytes(
      `https://api.mapbox.com/v4/${tileset}/${z}/${x}/${y}${scale}.pngraw?access_token=${token}`,
      {
        timeoutMs: 10_000,
        cacheTtlMs: TILE_TTL_MS,
        cacheKey: `terrain:${tileset}${scale}:${z}/${x}/${y}`,
      },
    );
}

/** Alturas (m) de los puntos pedidos, en el mismo orden. Lanza si alguna tesela no se pudo obtener. */
export async function terrainElevations(
  points: LatLon[],
  opts: {
    zoom: number;
    tileset: string;
    fetchTile: TileFetcher;
    decode?: TileDecoder;
    /** Clave de la caché en memoria; distinta si cambia el tamaño o el formato de la tesela. */
    cacheId?: string;
  },
): Promise<number[]> {
  const decode = opts.decode ?? decodePng;
  const size = 256;
  const where = points.map((p) => tileCoords(p, opts.zoom, size));
  const keys = [...new Set(where.map((w) => `${w.x}/${w.y}`))];
  const tiles = new Map<string, DecodedPng>();
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + CONCURRENCY).map(async (k) => {
        const memKey = `${opts.cacheId ?? opts.tileset}:${opts.zoom}/${k}`;
        const [x, y] = k.split("/").map(Number) as [number, number];
        const tile =
          memory.get(memKey)?.tile ??
          remember(
            memKey,
            opts.fetchTile(opts.tileset, opts.zoom, x, y).then((bytes) => decode(bytes)),
          );
        tiles.set(k, await tile);
      }),
    );
  }
  return where.map((w) => {
    const tile = tiles.get(`${w.x}/${w.y}`)!;
    const bx = tileBorder(tile.width);
    const by = tileBorder(tile.height);
    return sampleTile(
      tile,
      bx + (w.px * (tile.width - 2 * bx)) / size,
      by + (w.py * (tile.height - 2 * by)) / size,
    );
  });
}

/** Solo para tests: vacía la caché en memoria. */
export function clearTerrainMemory(): void {
  memory.clear();
}
