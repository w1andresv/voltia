"use server";

import type { Place, PlanRequest, PlanResponse, TripConditions, Vehicle } from "@/domain/types";
import { PlanRequestSchema } from "@/domain/schemas";
import { checkRateLimit, getClientIp } from "@/infrastructure/rate-limit";

const PlanSchema = PlanRequestSchema;

export async function searchPlacesFn(input: { data: { q: string; lat?: number; lon?: number } }): Promise<Place[]> {
  const data = input.data;
  const { searchPlaces } = await import("@/infrastructure/providers/geocode.photon");
  return searchPlaces(data.q, data.lat != null && data.lon != null ? { lat: data.lat, lon: data.lon } : undefined);
}

export async function reversePlaceFn(input: { data: { lat: number; lon: number } }): Promise<Place> {
  const { reversePlace } = await import("@/infrastructure/providers/geocode.photon");
  return reversePlace(input.data.lat, input.data.lon);
}

export async function planTripFn(input: { data: PlanRequest }): Promise<PlanResponse> {
  const ip = await getClientIp();
  // 20 planificaciones/min por IP: protege las cuotas de OSRM/Overpass, que
  // son gratis y compartidas con otros usuarios de esas APIs públicas.
  await checkRateLimit("plan-trip", ip, 20, 60);
  const data = PlanSchema.parse(input.data);
  const startedAt = Date.now();

  try {
    const { fetchRoutes } = await import("@/infrastructure/providers/routing");
    const { applyElevationAll } = await import("@/infrastructure/providers/elevation.openmeteo");
    const { fetchWeather } = await import("@/infrastructure/providers/weather.openmeteo");
    const { findChargersAlong } = await import("@/infrastructure/providers/chargers.overpass");
    const { loadCommunityChargers } = await import("@/server/actions/stations-db");
    const { buildPlan, rankPlans } = await import("@/domain/planner");
    const { isVerifiedForPlanning } = await import("@/domain/types");

    const waypoints = [data.origin, ...data.waypoints, data.destination];
    const warnings: string[] = [];
    const routed = await fetchRoutes(waypoints);
    const rawRoutes = routed.routes;
    warnings.push(...routed.warnings);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    // Cargadores a lo largo de TODAS las rutas (no solo la primera): así cada
    // alternativa puede planear sus paradas. Las sondas no se repiten donde se solapan.
    const chargerQuery = rawRoutes.flatMap((r) => r.samples);
    const community = (await loadCommunityChargers("all")).filter(isVerifiedForPlanning);
    const [routes, weather, chargerRes] = await Promise.all([
      applyElevationAll(rawRoutes),
      mid ? fetchWeather(mid) : Promise.resolve(null),
      findChargersAlong(chargerQuery, community),
    ]);
    if (routes.some((r) => r.elevation.maxM === 0 && r.elevation.minM === 0 && r.distanceKm > 5)) {
      warnings.push("No se obtuvo el perfil de elevación. El consumo puede estar subestimado en montaña.");
    }
    const { chargers, warnings: chargerWarnings } = chargerRes;
    warnings.push(...chargerWarnings);

    const built = routes.map((raw) =>
      buildPlan({
        raw,
        vehicle: data.vehicle as Vehicle,
        conditions: data.conditions as TripConditions,
        chargers,
        weather,
        origin: data.origin,
        destination: data.destination,
      }),
    );
    const ranked = rankPlans(built, data.conditions.planningMode);

    console.log(
      "[plan-trip]",
      JSON.stringify({
        ms: Date.now() - startedAt,
        engine: routed.engine,
        routes: routes.length,
        distanceKm: Math.round(routes[0]?.distanceKm ?? 0),
        chargers: chargers.length,
        warnings: warnings.length,
        weather: weather != null,
      }),
    );

    return {
      geo: { routes, chargers, weather, warnings },
      plans: ranked,
      selectedId: ranked[0]?.id ?? "",
    };
  } catch (error) {
    console.error(
      "[plan-trip] failed",
      JSON.stringify({
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw error;
  }
}
