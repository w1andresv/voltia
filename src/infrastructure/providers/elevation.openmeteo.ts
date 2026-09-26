import type { LatLon } from "@/domain/types";
import { fetchJson } from "./http";

interface MeteoElev {
  elevation?: number[];
  error?: boolean;
}

interface OpenTopo {
  status?: string;
  results?: { elevation: number | null }[];
}

async function fromOpenTopo(lats: number[], lons: number[]): Promise<number[]> {
  const locs = lats.map((lat, i) => `${lat},${lons[i]}`).join("|");
  const url = `https://api.opentopodata.org/v1/aster30m?locations=${locs}`;
  const data = await fetchJson<OpenTopo>(url, {
    timeoutMs: 14000,
    cacheTtlMs: 24 * 3600_000,
    headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
  });
  if (data.status !== "OK" || !data.results) throw new Error("opentopo");
  return data.results.map((r) => r.elevation ?? 0);
}

async function fromOpenMeteo(lats: number[], lons: number[]): Promise<number[]> {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
  const data = await fetchJson<MeteoElev>(url, {
    timeoutMs: 8000,
    cacheTtlMs: 24 * 3600_000,
  });
  if (data.error || !data.elevation?.length) throw new Error("open-meteo elevation");
  return data.elevation;
}

async function elevationsFor(lats: number[], lons: number[]): Promise<number[]> {
  try {
    return await fromOpenMeteo(lats, lons);
  } catch {
    return fromOpenTopo(lats, lons);
  }
}

/** Alturas (m) para los puntos pedidos, en el mismo orden. Hasta 100 puntos por consulta. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  return elevationsFor(
    points.map((p) => p.lat),
    points.map((p) => p.lon),
  );
}
