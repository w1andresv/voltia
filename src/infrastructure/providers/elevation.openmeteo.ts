import type { LatLon } from "@/domain/types";
import { CACHE_FOREVER, fetchJson } from "./http";

interface MeteoElev {
  elevation?: number[];
  error?: boolean;
}

interface OpenTopo {
  status?: string;
  results?: { elevation: number | null }[];
}

/**
 * OpenTopoData gratuito admite 1 consulta por segundo: las consultas de
 * respaldo se encadenan con una pausa entre ellas en vez de salir en paralelo.
 */
export const OPEN_TOPO_GAP_MS = 1100;
let openTopoQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throttledOpenTopo(lats: number[], lons: number[]): Promise<number[]> {
  const run = openTopoQueue.then(() => fromOpenTopo(lats, lons));
  openTopoQueue = run.catch(() => undefined).then(() => sleep(OPEN_TOPO_GAP_MS));
  return run;
}

async function fromOpenTopo(lats: number[], lons: number[]): Promise<number[]> {
  const locs = lats.map((lat, i) => `${lat},${lons[i]}`).join("|");
  const url = `https://api.opentopodata.org/v1/aster30m?locations=${locs}`;
  const data = await fetchJson<OpenTopo>(url, {
    timeoutMs: 14000,
    // La elevación no cambia: sin vencimiento.
    cacheTtlMs: CACHE_FOREVER,
    headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
  });
  if (data.status !== "OK" || !data.results) throw new Error("opentopo");
  return data.results.map((r) => r.elevation ?? 0);
}

async function fromOpenMeteo(lats: number[], lons: number[]): Promise<number[]> {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
  const data = await fetchJson<MeteoElev>(url, {
    timeoutMs: 8000,
    cacheTtlMs: CACHE_FOREVER,
  });
  if (data.error || !data.elevation?.length) throw new Error("open-meteo elevation");
  return data.elevation;
}

/** Pausas antes de reintentar Open-Meteo cuando responde 429 (límite de ráfaga). */
export const OPEN_METEO_RATE_BACKOFF_MS = [1000, 2500];

async function elevationsFor(lats: number[], lons: number[]): Promise<number[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fromOpenMeteo(lats, lons);
    } catch (err) {
      const limited = err instanceof Error && err.message.startsWith("HTTP 429");
      const wait = OPEN_METEO_RATE_BACKOFF_MS[attempt];
      if (!limited || wait === undefined) break;
      await sleep(wait);
    }
  }
  return throttledOpenTopo(lats, lons);
}

/** Open-Meteo acepta hasta 100 puntos por consulta. */
export const OPEN_METEO_MAX_POINTS = 100;
/** Más de 2 a la vez dispara el límite de ráfaga (429) de Open-Meteo gratuito. */
const PARALLEL_QUERIES = 2;

/**
 * Alturas (m) para los puntos pedidos, en el mismo orden. Más de 100 puntos se
 * piden en lotes de 100, hasta 2 a la vez; un lote limitado (429) se reintenta
 * con pausa y, si sigue fallando, va a OpenTopoData de a uno por segundo. Si
 * un lote falla en ambos, falla todo.
 */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const batches: LatLon[][] = [];
  for (let i = 0; i < points.length; i += OPEN_METEO_MAX_POINTS) {
    batches.push(points.slice(i, i + OPEN_METEO_MAX_POINTS));
  }
  const out: number[][] = [];
  for (let i = 0; i < batches.length; i += PARALLEL_QUERIES) {
    const part = await Promise.all(
      batches.slice(i, i + PARALLEL_QUERIES).map((b) =>
        elevationsFor(
          b.map((p) => p.lat),
          b.map((p) => p.lon),
        ),
      ),
    );
    out.push(...part);
  }
  return out.flat();
}
