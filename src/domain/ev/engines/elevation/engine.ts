import { downsample, lerp } from "@/domain/geo";
import type { RawRoute } from "@/domain/types";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";

/**
 * Elevación de la ruta. El proveedor solo devuelve alturas para los puntos que
 * se le piden; qué puntos pedir y cómo aplicarlas (interpolación, suavizado,
 * pendientes y desnivel) es del dominio. F2 conserva el cálculo anterior: la
 * malla por distancia y la limpieza de túneles y puentes esperan la decisión B6.
 */

type Sample = RawRoute["samples"][number];

/** Muestras de la ruta en las que se consulta la elevación. null si la ruta no tiene tramos. */
export function elevationProbes(
  route: RawRoute,
  params: ModelParameters["elevation"] = MODEL_PARAMETERS.elevation,
): Sample[] | null {
  if (route.samples.length < 2) return null;
  return downsample(route.samples, params.probesPerRoute);
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

/** La ruta con la elevación de cada muestra, la pendiente de cada tramo y el desnivel total. */
export function applyElevationProfile(
  route: RawRoute,
  probes: Sample[],
  elev: number[],
  params: ModelParameters["elevation"] = MODEL_PARAMETERS.elevation,
): RawRoute {
  const samples = route.samples;
  const probeKm = probes.map((p) => p.km);
  const rawElev = samples.map((s) => interpolateElev(s.km, probeKm, elev));
  const smoothed = smoothSeries(rawElev, params.smoothingWindow);
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
    if (d > params.gainThresholdM) gain += d;
    else if (d < -params.gainThresholdM) loss += -d;
    minM = Math.min(minM, withElev[i]!.elevM);
    maxM = Math.max(maxM, withElev[i]!.elevM);
  }
  return {
    ...route,
    samples: withElev,
    elevation: { gainM: gain, lossM: loss, minM, maxM },
  };
}
