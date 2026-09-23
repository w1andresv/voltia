import type { RawRoute } from "@/domain/types";
import { downsample, lerp } from "@/domain/geo";
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

export async function applyElevation(route: RawRoute): Promise<RawRoute> {
  const samples = route.samples;
  if (samples.length < 2) return route;
  const probes = downsample(samples, 48);
  try {
    const elev = await elevationsFor(
      probes.map((p) => p.lat),
      probes.map((p) => p.lon),
    );
    const probeKm = probes.map((p) => p.km);
    const rawElev = samples.map((s) => interpolateElev(s.km, probeKm, elev));
    const smoothed = smoothSeries(rawElev, 5);
    const withElev = samples.map((s, i) => ({
      ...s,
      elevM: smoothed[i] ?? s.elevM,
    }));
    for (let i = 1; i < withElev.length; i++) {
      const dKm = Math.max(0.05, withElev[i]!.km - withElev[i - 1]!.km);
      const dM = withElev[i]!.elevM - withElev[i - 1]!.elevM;
      withElev[i]!.slopePct = (dM / (dKm * 1000)) * 100;
    }
    let gain = 0;
    let loss = 0;
    let minM = withElev[0]!.elevM;
    let maxM = withElev[0]!.elevM;
    for (let i = 1; i < withElev.length; i++) {
      const d = withElev[i]!.elevM - withElev[i - 1]!.elevM;
      if (d > 2) gain += d;
      else if (d < -2) loss += -d;
      minM = Math.min(minM, withElev[i]!.elevM);
      maxM = Math.max(maxM, withElev[i]!.elevM);
    }
    return {
      ...route,
      samples: withElev,
      elevation: { gainM: gain, lossM: loss, minM, maxM },
    };
  } catch {
    return route;
  }
}

function interpolateElev(km: number, probeKm: number[], elev: number[]): number {
  if (!probeKm.length) return 0;
  if (km <= probeKm[0]!) return elev[0] ?? 0;
  for (let i = 1; i < probeKm.length; i++) {
    if (km <= probeKm[i]!) {
      const span = probeKm[i]! - probeKm[i - 1]! || 1;
      const t = (km - probeKm[i - 1]!) / span;
      return lerp(elev[i - 1] ?? 0, elev[i] ?? 0, t);
    }
  }
  return elev[elev.length - 1] ?? 0;
}

function smoothSeries(values: number[], window: number): number[] {
  if (values.length < 3) return values;
  const half = Math.max(1, Math.floor(window / 2));
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (v == null) continue;
      sum += v;
      n += 1;
    }
    return n ? sum / n : values[i]!;
  });
}

export async function applyElevationAll(routes: RawRoute[]): Promise<RawRoute[]> {
  return Promise.all(routes.map((route) => applyElevation(route)));
}
