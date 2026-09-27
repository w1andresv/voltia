/**
 * Terrain-RGB v1 (la de hoy) contra Terrain-DEM v1 de Mapbox sobre una ruta
 * real (por defecto Piedecuesta → Vélez): por qué API responde cada una,
 * cuántas teselas pide (cada tesela es una consulta que Mapbox factura), qué
 * resolución da, cuánto difieren las alturas y cómo cambia el plan.
 *
 * Uso: `npm run elevation:dem`, o con otra ruta:
 *   ORIGIN=7.1193,-73.1227 DESTINATION=4.711,-74.0721 npm run elevation:dem
 *
 * Necesita red hacia api.mapbox.com y MAPBOX_ACCESS_TOKEN en .env.local. No
 * imprime el token. Para leer WebP usa sharp (viene instalado con Next).
 */
import { expect, it, vi } from "vitest";
import type { Place, RawRoute } from "@/domain/types";
import type { DecodedPng } from "@/infrastructure/providers/png";
import { PIEDECUESTA_VELEZ } from "./scenarios";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

const RGB = "mapbox.terrain-rgb";
const DEM = "mapbox.mapbox-terrain-dem-v1";
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

interface Endpoint {
  api: string;
  pattern: string;
  url: (token: string, tileset: string, z: number, x: number, y: number) => string;
}

const V4: Endpoint = {
  api: "Raster Tiles API v4",
  pattern: "/v4/{tileset}/{z}/{x}/{y}.pngraw",
  url: (t, ts, z, x, y) =>
    `https://api.mapbox.com/v4/${ts}/${z}/${x}/${y}.pngraw?access_token=${t}`,
};
const V4_2X: Endpoint = {
  api: "Raster Tiles API v4 @2x",
  pattern: "/v4/{tileset}/{z}/{x}/{y}@2x.pngraw",
  url: (t, ts, z, x, y) =>
    `https://api.mapbox.com/v4/${ts}/${z}/${x}/${y}@2x.pngraw?access_token=${t}`,
};
/** Las que puede servir Terrain-DEM, en orden de preferencia (v4 tiene facturación documentada). */
const DEM_ENDPOINTS: Endpoint[] = [
  V4,
  {
    api: "raster/v1 .webp (la de Mapbox GL JS)",
    pattern: "/raster/v1/{tileset}/{z}/{x}/{y}.webp",
    url: (t, ts, z, x, y) =>
      `https://api.mapbox.com/raster/v1/${ts}/${z}/${x}/${y}.webp?access_token=${t}`,
  },
  {
    api: "raster/v1 .png",
    pattern: "/raster/v1/{tileset}/{z}/{x}/{y}.png",
    url: (t, ts, z, x, y) =>
      `https://api.mapbox.com/raster/v1/${ts}/${z}/${x}/${y}.png?access_token=${t}`,
  },
];

function place(env: string | undefined, fallback: Place): Place {
  if (!env) return fallback;
  const [lat, lon] = env.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new Error(`Coordenadas inválidas: ${env}`);
  return { label: env, lat: lat!, lon: lon! };
}

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function isWebp(b: Uint8Array): boolean {
  const tag = (from: number) => String.fromCharCode(...b.subarray(from, from + 4));
  return b.length > 12 && tag(0) === "RIFF" && tag(8) === "WEBP";
}

/** PNG con el decodificador propio; WebP con sharp (solo en este script). */
async function decodeAny(bytes: Uint8Array): Promise<DecodedPng> {
  const { decodePng } = await import("@/infrastructure/providers/png");
  if (isPng(bytes)) return decodePng(bytes);
  if (!isWebp(bytes)) throw new Error("la tesela no es PNG ni WebP");
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(Buffer.from(bytes))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data: new Uint8Array(data),
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

it("compara Terrain-RGB v1 con Terrain-DEM v1", async () => {
  await import("../../scripts/load-env.mjs");
  const { mapboxServerToken } = await import("@/infrastructure/providers/routing.mapbox");
  const token = mapboxServerToken();
  if (!token) throw new Error("Falta MAPBOX_ACCESS_TOKEN en .env.local.");
  const hide = (text: string) => text.split(token).join("***");

  const { MapboxRoutingProvider, MapboxTerrainElevationProvider } =
    await import("@/infrastructure/providers/adapters");
  const { tileBorder, tileCoords } =
    await import("@/infrastructure/providers/elevation.mapbox-terrain");
  const { selectRoutes } = await import("@/application/plan-trip/route-selection");
  const { profileRoute } = await import("@/application/plan-trip/elevation-profile");
  const { computePlans } = await import("@/domain/ev/compute-plan");
  const { MODEL_PARAMETERS } = await import("@/domain/ev/core/params");

  const base = PIEDECUESTA_VELEZ.request();
  const origin = place(process.env.ORIGIN, base.origin);
  const destination = place(process.env.DESTINATION, base.destination);
  const { routes } = await selectRoutes(new MapboxRoutingProvider(token), [origin, destination]);
  const route = routes[0] as RawRoute;
  expect(route).toBeDefined();
  const mid = route.samples[Math.floor(route.samples.length / 2)]!;
  const cosLat = Math.cos((mid.lat * Math.PI) / 180);

  // Cuenta las consultas a Mapbox de cada variante (la ruta ya se pidió).
  const realFetch = globalThis.fetch;
  let requests = 0;
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).includes("api.mapbox.com")) requests++;
    return realFetch(...args);
  });

  async function download(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
      throw new Error(hide(`HTTP ${res.status}${body ? ` — ${body}` : ""}`));
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // 1. ¿Por qué API responde Terrain-DEM v1? Tesela del punto medio de la ruta, zoom 12.
  const probeTile = tileCoords(mid, 12, 256);
  const probes: Record<string, string | number>[] = [];
  let demEndpoint: Endpoint | null = null;
  for (const endpoint of DEM_ENDPOINTS) {
    const row: Record<string, string | number> = {
      api: endpoint.api,
      ruta: endpoint.pattern.replace("{tileset}", DEM),
    };
    try {
      const bytes = await download(endpoint.url(token, DEM, 12, probeTile.x, probeTile.y));
      const tile = await decodeAny(bytes);
      Object.assign(row, {
        resultado: "responde",
        formato: isPng(bytes) ? "PNG" : "WebP",
        "px tesela": `${tile.width}×${tile.height}`,
        bytes: bytes.length,
      });
      demEndpoint ??= endpoint;
    } catch (e) {
      row.resultado = hide(e instanceof Error ? e.message : String(e));
    }
    probes.push(row);
  }

  // 2. Las dos opciones sobre la misma ruta, más las variantes a zoom 11 con teselas de 512 px:
  //    la misma resolución que hoy con menos teselas (menos consultas facturables).
  const variants: { label: string; tileset: string; zoom: number; endpoint: Endpoint | null }[] = [
    // La primera es la referencia de la tabla 3: la malla más fina de 256 px.
    { label: "Terrain-RGB v1 · z12", tileset: RGB, zoom: 12, endpoint: V4 },
    { label: "Terrain-RGB v1 · z11 @2x", tileset: RGB, zoom: 11, endpoint: V4_2X },
    { label: "Terrain-DEM v1 · z12", tileset: DEM, zoom: 12, endpoint: demEndpoint },
    // Por la API v4 Terrain-DEM llega en 256 px (medido 2026-09-27): a zoom 11 se pide @2x,
    // como Terrain-RGB, para comparar con la misma resolución.
    demEndpoint === V4
      ? { label: "Terrain-DEM v1 · z11 @2x", tileset: DEM, zoom: 11, endpoint: V4_2X }
      : { label: "Terrain-DEM v1 · z11", tileset: DEM, zoom: 11, endpoint: demEndpoint },
  ];
  // Marca la que usa la app hoy (ModelParameters.elevation.terrain).
  const prod = MODEL_PARAMETERS.elevation.terrain;
  for (const v of variants) {
    const retina = v.endpoint === V4_2X;
    if (v.tileset === prod.tileset && v.zoom === prod.zoom && retina === prod.retina)
      v.label += " (producción)";
  }
  const rows: Record<string, string | number>[] = [];
  const profiles = new Map<string, number[]>();
  for (const v of variants) {
    const row: Record<string, string | number> = { opción: v.label, api: v.endpoint?.api ?? "—" };
    rows.push(row);
    if (!v.endpoint) {
      row.error = "ninguna API respondió para Terrain-DEM v1 (ver la tabla anterior)";
      continue;
    }
    const endpoint = v.endpoint;
    const widths = new Set<number>();
    const provider = new MapboxTerrainElevationProvider(
      token,
      { zoom: v.zoom, tileset: v.tileset },
      (tileset, z, x, y) => download(endpoint.url(token, tileset, z, x, y)),
      async (bytes) => {
        const tile = await decodeAny(bytes);
        widths.add(tile.width);
        return tile;
      },
      v.label,
    );
    requests = 0;
    const { route: profiled, report } = await profileRoute(
      route,
      { provider, sampling: "mesh" },
      MODEL_PARAMETERS.elevation,
    );
    const tiles = requests;
    if (report.error) {
      Object.assign(row, { teselas: tiles, error: hide(report.error) });
      continue;
    }
    const width = Math.max(...widths);
    const content = width - 2 * tileBorder(width);
    const [plan] = computePlans(
      { routes: [profiled], chargers: [], weather: null, origin, destination },
      base.vehicle,
      base.conditions,
    ).plans;
    profiles.set(
      v.label,
      profiled.samples.map((s) => s.elevM),
    );
    Object.assign(row, {
      teselas: tiles,
      "px tesela": width,
      "m/píxel": round1((EARTH_CIRCUMFERENCE_M * cosLat) / (2 ** v.zoom * content)),
      ms: report.ms,
      "subida m": Math.round(profiled.elevation.gainM),
      "bajada m": Math.round(profiled.elevation.lossM),
      "mín m": Math.round(profiled.elevation.minM),
      "máx m": Math.round(profiled.elevation.maxM),
      kWh: round1(plan!.energyKwh),
      "SOC llegada": round1(plan!.arrivalSoc),
    });
  }
  vi.unstubAllGlobals();

  // 3. Cuánto difieren las alturas de cada variante contra la actual, en los mismos puntos.
  const baseline = profiles.get(variants[0]!.label);
  const diffs: Record<string, string | number>[] = [];
  for (const v of variants.slice(1)) {
    const other = profiles.get(v.label);
    if (!baseline || !other) continue;
    const d = baseline.map((h, i) => Math.abs(h - (other[i] ?? h))).sort((a, b) => a - b);
    diffs.push({
      opción: v.label,
      "media |Δh| m": round1(d.reduce((a, b) => a + b, 0) / d.length),
      "p95 |Δh| m": round1(percentile(d, 0.95)),
      "máx |Δh| m": round1(d[d.length - 1]!),
    });
  }

  console.log(
    `\n[terreno] ${origin.label} → ${destination.label}: ${route.distanceKm.toFixed(1)} km, ` +
      `${route.samples.length} muestras, ${base.vehicle.brand} ${base.vehicle.model}, SOC salida ${base.conditions.initialSoc} %`,
  );
  console.log(
    `\n[terreno] 1. ¿Por qué API responde Terrain-DEM v1? (tesela ${probeTile.x}/${probeTile.y}, z12)`,
  );
  console.table(probes);
  console.log(
    "\n[terreno] 2. Las dos opciones sobre la ruta (una tesela = una consulta facturable)",
  );
  console.table(rows);
  if (diffs.length) {
    console.log(
      `\n[terreno] 3. Diferencia de alturas contra ${variants[0]!.label} (mismos puntos)`,
    );
    console.table(diffs);
  }
}, 300_000);
