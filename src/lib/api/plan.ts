"use server";

import { z } from "zod";
import type { Place, PlanRequest, PlanResponse, TripConditions, Vehicle } from "@/lib/domain/types";
import { checkRateLimit, getClientIp } from "@/infrastructure/rate-limit";

const PlaceSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  context: z.string().optional(),
});

const VehicleSchema = z.object({
  id: z.string(),
  brand: z.string(),
  model: z.string(),
  year: z.number(),
  version: z.string(),
  batteryKwh: z.number().positive(),
  rangeKm: z.number().positive(),
  consumptionKwhPer100km: z.number().positive().nullable(),
  consumptionManual: z.boolean().optional(),
  weightKg: z.number().positive(),
  motorKw: z.number().positive(),
  acMaxKw: z.number().positive(),
  dcMaxKw: z.number().positive(),
  chargeCurve: z.array(z.object({ soc: z.number(), powerFactor: z.number() })),
  connectors: z.array(z.enum(["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"])),
  minSocRecommended: z.number(),
  maxSocTravel: z.number(),
  regenPct: z.number().min(5).max(80).optional(),
  isCustom: z.boolean().optional(),
});

const ConditionsSchema = z.object({
  passengers: z.number().min(0).max(8),
  luggageKg: z.number().min(0).max(400),
  initialSoc: z.number().min(1).max(100),
  arrivalSoc: z.number().min(0).max(80),
  avgSpeedKmh: z.number().nullable(),
  ac: z.enum(["off", "eco", "normal", "max"]),
  temperatureC: z.number().nullable(),
  drivingStyle: z.enum(["efficient", "normal", "sport"]),
  safetyMode: z.enum(["conservative", "normal", "low", "custom"]),
  customSafetyPct: z.number().min(5).max(40),
  planningMode: z.enum(["fastest", "efficient", "fewer_stops", "safer", "custom"]),
  allowBelowSafety: z.boolean(),
  regenPct: z.number().min(5).max(80).optional().default(20),
});

const PlanSchema = z.object({
  origin: PlaceSchema,
  destination: PlaceSchema,
  waypoints: z.array(PlaceSchema).max(5),
  vehicle: VehicleSchema,
  conditions: ConditionsSchema,
  plugshareToken: z.string().max(4000).optional(),
});

export async function searchPlacesFn(input: { data: { q: string; lat?: number; lon?: number } }): Promise<Place[]> {
  const data = input.data;
  const { searchPlaces } = await import("@/lib/providers/geocode.photon");
  return searchPlaces(data.q, data.lat != null && data.lon != null ? { lat: data.lat, lon: data.lon } : undefined);
}

export async function reversePlaceFn(input: { data: { lat: number; lon: number } }): Promise<Place> {
  const { reversePlace } = await import("@/lib/providers/geocode.photon");
  return reversePlace(input.data.lat, input.data.lon);
}

export async function planTripFn(input: { data: PlanRequest & { plugshareToken?: string } }): Promise<PlanResponse> {
  const ip = await getClientIp();
  // 20 planificaciones/min por IP: protege las cuotas de OSRM/Overpass, que
  // son gratis y compartidas con otros usuarios de esas APIs públicas.
  await checkRateLimit("plan-trip", ip, 20, 60);
  const data = PlanSchema.parse(input.data);
    const { fetchRoutes } = await import("@/lib/providers/routing.osrm");
    const { applyElevationAll } = await import("@/lib/providers/elevation.openmeteo");
    const { fetchWeather } = await import("@/lib/providers/weather.openmeteo");
    const { findChargersAlong } = await import("@/lib/providers/chargers.overpass");
    const { loadCommunityChargers } = await import("@/lib/api/stations-db");
    const { buildPlan, rankPlans } = await import("@/lib/domain/planner");
    const { isVerifiedForPlanning } = await import("@/lib/domain/types");

    const waypoints = [data.origin, ...data.waypoints, data.destination];
    const warnings: string[] = [];
    const rawRoutes = await fetchRoutes(waypoints);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    const chargerQuery = rawRoutes[0]?.samples ?? [];
    const community = (await loadCommunityChargers("all")).filter(isVerifiedForPlanning);
    const [routes, weather, chargerRes] = await Promise.all([
      applyElevationAll(rawRoutes),
      mid ? fetchWeather(mid) : Promise.resolve(null),
      findChargersAlong(chargerQuery, community, data.plugshareToken),
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
    return {
      geo: { routes, chargers, weather, warnings },
      plans: ranked,
      selectedId: ranked[0]?.id ?? "",
    };
}
