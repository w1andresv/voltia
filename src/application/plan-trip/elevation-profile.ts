/**
 * Elevación de una ruta según la estrategia configurada (ELEVATION_SOURCE,
 * ADR-0011). Qué puntos pedir y cómo aplicarlos es del dominio
 * (engines/elevation); aquí solo se piden al proveedor y se decide qué hacer
 * si falla.
 */
import type { ModelParameters } from "@/domain/ev/core/params";
import {
  adaptiveRefinement,
  applyDenseElevationProfile,
  applyElevationProfile,
  elevationMesh,
  elevationProbes,
} from "@/domain/ev/engines/elevation/engine";
import type { ElevationProvider } from "@/domain/ports/elevation";
import type { RawRoute } from "@/domain/types";

/** fixed: 96 puntos repartidos (la de siempre). mesh: cada 100 m. adaptive: gruesa y densa donde cambia. */
export type ElevationSampling = "fixed" | "mesh" | "adaptive";

export interface ElevationSetup {
  provider: ElevationProvider;
  sampling: ElevationSampling;
  /** Si el principal falla, este con la estrategia fija (la de siempre). */
  fallback?: ElevationProvider;
}

export interface ElevationReport {
  /** Proveedor y estrategia que dieron el perfil; null si la ruta quedó plana. */
  source: string | null;
  points: number;
  ms: number;
  /** Motivo si el principal falló. */
  error?: string;
}

/** Nombre del perfil para el snapshot y los logs ("open-meteo", "mapbox-terrain/mesh"). */
export function elevationSourceLabel(
  provider: ElevationProvider,
  sampling: ElevationSampling,
): string {
  return sampling === "fixed" ? provider.id : `${provider.id}/${sampling}`;
}

async function withSampling(
  route: RawRoute,
  provider: ElevationProvider,
  sampling: ElevationSampling,
  params: ModelParameters["elevation"],
): Promise<{ route: RawRoute; points: number }> {
  if (sampling === "fixed") {
    const probes = elevationProbes(route, params);
    if (!probes) return { route, points: 0 };
    const heights = await provider.getElevations(probes);
    return { route: applyElevationProfile(route, probes, heights, params), points: probes.length };
  }
  if (sampling === "mesh") {
    const mesh = elevationMesh(route, params.mesh.spacingM);
    if (!mesh.length) return { route, points: 0 };
    const heights = await provider.getElevations(mesh);
    return { route: applyDenseElevationProfile(route, mesh, heights, params), points: mesh.length };
  }
  const coarse = elevationMesh(route, params.adaptive.coarseSpacingM);
  if (!coarse.length) return { route, points: 0 };
  const coarseHeights = await provider.getElevations(coarse);
  const extra = adaptiveRefinement(route, coarse, coarseHeights, params.adaptive);
  const extraHeights = extra.length ? await provider.getElevations(extra) : [];
  return {
    route: applyDenseElevationProfile(
      route,
      [...coarse, ...extra],
      [...coarseHeights, ...extraHeights],
      params,
    ),
    points: coarse.length + extra.length,
  };
}

/**
 * La ruta con su perfil de elevación. Si el proveedor principal falla, se usa
 * el de respaldo con la estrategia fija; si también falla, la ruta sigue plana
 * y el plan lo avisa (como antes).
 */
export async function profileRoute(
  route: RawRoute,
  setup: ElevationSetup,
  params: ModelParameters["elevation"],
): Promise<{ route: RawRoute; report: ElevationReport }> {
  const t0 = Date.now();
  let error: string | undefined;
  try {
    const out = await withSampling(route, setup.provider, setup.sampling, params);
    return {
      route: out.route,
      report: {
        source: elevationSourceLabel(setup.provider, setup.sampling),
        points: out.points,
        ms: Date.now() - t0,
      },
    };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (setup.fallback && (setup.fallback !== setup.provider || setup.sampling !== "fixed")) {
    try {
      const out = await withSampling(route, setup.fallback, "fixed", params);
      return {
        route: out.route,
        report: { source: setup.fallback.id, points: out.points, ms: Date.now() - t0, error },
      };
    } catch {
      // sigue plana
    }
  }
  return { route, report: { source: null, points: 0, ms: Date.now() - t0, error } };
}
