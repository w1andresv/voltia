import type { PlanRequest, PlanResponse, RoutingEngine, TripConditions, Vehicle } from "@/domain/types";
import type { StationDataset } from "@/domain/stations/model";

export interface PlanPipelineResult {
  response: PlanResponse;
  engine: RoutingEngine;
  chargerCount: number;
}

/**
 * Rutas → elevación, clima y electrolineras → planes ordenados. Es lo que
 * ejecuta planTripFn; está aparte para que la grabación y la reproducción del
 * fixture (src/test-support) usen exactamente el mismo camino. De dónde salen
 * las estaciones lo decide quien llama (Postgres en la app, la grabación en tests).
 */
export async function runPlanPipeline(
  data: PlanRequest,
  loadStations: () => Promise<StationDataset>,
): Promise<PlanPipelineResult> {
  const { fetchRoutes } = await import("@/infrastructure/providers/routing");
  const { applyElevationAll } = await import("@/infrastructure/providers/elevation.openmeteo");
  const { fetchWeather } = await import("@/infrastructure/providers/weather.openmeteo");
  const { findStationsNearRoute } = await import("@/domain/stations/spatial");
  const { toPlanningCharger } = await import("@/domain/stations/to-charger");
  const { buildPlan, rankPlans, MAX_FROM_ROUTE_KM } = await import("@/domain/planner");

  const waypoints = [data.origin, ...data.waypoints, data.destination];
  const warnings: string[] = [];
  const routed = await fetchRoutes(waypoints);
  const rawRoutes = routed.routes;
  warnings.push(...routed.warnings);
  const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
  // Cargadores a lo largo de TODAS las rutas (no solo la primera): así cada
  // alternativa puede planear sus paradas. Las sondas no se repiten donde se solapan.
  const chargerQuery = rawRoutes.flatMap((r) => r.samples);
  const [routes, weather, dataset] = await Promise.all([
    applyElevationAll(rawRoutes),
    mid ? fetchWeather(mid) : Promise.resolve(null),
    loadStations(),
  ]);
  if (routes.some((r) => r.elevation.maxM === 0 && r.elevation.minM === 0 && r.distanceKm > 5)) {
    warnings.push("No se obtuvo el perfil de elevación. El consumo puede estar subestimado en montaña.");
  }
  for (const s of dataset.sources) {
    if (s.stale) warnings.push(`Electrolineras de ${s.id}: usando el último dato disponible (fuente lenta o caída).`);
    else if (!s.ok && s.error) warnings.push(`No se pudo consultar electrolineras de ${s.id}.`);
  }
  const chargers = findStationsNearRoute(dataset.stations, chargerQuery, MAX_FROM_ROUTE_KM)
    .filter((s) => s.planning.eligible)
    .map(toPlanningCharger);

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
    response: {
      geo: { routes, chargers, weather, warnings, stationsVersion: dataset.version },
      plans: ranked,
      selectedId: ranked[0]?.id ?? "",
    },
    engine: routed.engine,
    chargerCount: chargers.length,
  };
}
