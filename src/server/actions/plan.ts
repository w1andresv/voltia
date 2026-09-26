"use server";

import type { Place, PlanRequest, PlanResponse } from "@/domain/types";
import { PlanRequestSchema } from "@/domain/schemas";
import { checkRateLimit, getClientIp } from "@/infrastructure/rate-limit";

const PlanSchema = PlanRequestSchema;

export async function searchPlacesFn(input: { data: { q: string; lat?: number; lon?: number } }): Promise<Place[]> {
  const data = input.data;
  const { createGeocoder } = await import("@/application/container");
  return createGeocoder().search(data.q, data.lat != null && data.lon != null ? { lat: data.lat, lon: data.lon } : undefined);
}

export async function reversePlaceFn(input: { data: { lat: number; lon: number } }): Promise<Place> {
  const { createGeocoder } = await import("@/application/container");
  return createGeocoder().reverse({ lat: input.data.lat, lon: input.data.lon });
}

export async function planTripFn(input: { data: PlanRequest }): Promise<PlanResponse> {
  const ip = await getClientIp();
  // 20 planificaciones/min por IP: protege las cuotas de OSRM/Overpass, que
  // son gratis y compartidas con otros usuarios de esas APIs públicas.
  await checkRateLimit("plan-trip", ip, 20, 60);
  const data = PlanSchema.parse(input.data);
  const startedAt = Date.now();

  try {
    const { createPlanningService } = await import("@/application/container");
    const { response, engine, chargerCount } = await createPlanningService().plan(data);

    console.log(
      "[plan-trip]",
      JSON.stringify({
        ms: Date.now() - startedAt,
        engine,
        routes: response.geo.routes.length,
        distanceKm: Math.round(response.geo.routes[0]?.distanceKm ?? 0),
        chargers: chargerCount,
        stationsVersion: response.geo.stationsVersion,
        warnings: response.geo.warnings.length,
        weather: response.geo.weather != null,
      }),
    );

    return response;
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
