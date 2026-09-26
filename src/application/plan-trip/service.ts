import type { ElevationProvider } from "@/domain/ports/elevation";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { ModelParameters } from "@/domain/ev/core/params";
import { buildPlan, rankPlans } from "@/domain/planner";
import { findStationsNearRoute } from "@/domain/stations/spatial";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import type { PlanRequest, PlanResponse, RoutingEngine, TripConditions, Vehicle } from "@/domain/types";

/** `legacy`: motor actual. `shadow` y `v2` llegan con el motor nuevo (plan §6); hasta entonces se usa `legacy`. */
export type PlannerEngineMode = "legacy" | "shadow" | "v2";

export interface PlanningDeps {
  routing: RoutingProvider;
  elevation: ElevationProvider;
  weather: WeatherProvider | null;
  stations: StationCatalog;
  params: ModelParameters;
  engineMode: PlannerEngineMode;
}

export interface PlanResult {
  response: PlanResponse;
  engine: RoutingEngine;
  chargerCount: number;
}

/**
 * Caso de uso "planificar un viaje": reúne los datos por los puertos y compone
 * el plan. No conoce a Mapbox, Open-Meteo ni Postgres (eso lo arma container.ts).
 */
export class EVRoutePlanningService {
  constructor(private readonly deps: PlanningDeps) {}

  async plan(data: PlanRequest): Promise<PlanResult> {
    const { routing, elevation, weather, stations, params } = this.deps;
    const waypoints = [data.origin, ...data.waypoints, data.destination];
    const warnings: string[] = [];
    const routed = await routing.routes(waypoints);
    const rawRoutes = routed.routes;
    warnings.push(...routed.warnings);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    // Cargadores a lo largo de TODAS las rutas (no solo la primera): así cada
    // alternativa puede planear sus paradas.
    const chargerQuery = rawRoutes.flatMap((r) => r.samples);
    const [routes, snapshot, dataset] = await Promise.all([
      elevation.applyTo(rawRoutes),
      mid && weather ? weather.current(mid) : Promise.resolve(null),
      stations.getDataset(),
    ]);
    if (routes.some((r) => r.elevation.maxM === 0 && r.elevation.minM === 0 && r.distanceKm > 5)) {
      warnings.push("No se obtuvo el perfil de elevación. El consumo puede estar subestimado en montaña.");
    }
    for (const s of dataset.sources) {
      if (s.stale) warnings.push(`Electrolineras de ${s.id}: usando el último dato disponible (fuente lenta o caída).`);
      else if (!s.ok && s.error) warnings.push(`No se pudo consultar electrolineras de ${s.id}.`);
    }
    const chargers = findStationsNearRoute(dataset.stations, chargerQuery, params.corridor.maxFromRouteKm)
      .filter((s) => s.planning.eligible)
      .map(toPlanningCharger);

    const built = routes.map((raw) =>
      buildPlan({
        raw,
        vehicle: data.vehicle as Vehicle,
        conditions: data.conditions as TripConditions,
        chargers,
        weather: snapshot,
        origin: data.origin,
        destination: data.destination,
      }),
    );
    const ranked = rankPlans(built, data.conditions.planningMode);

    return {
      response: {
        geo: { routes, chargers, weather: snapshot, warnings, stationsVersion: dataset.version },
        plans: ranked,
        selectedId: ranked[0]?.id ?? "",
      },
      engine: routed.engine,
      chargerCount: chargers.length,
    };
  }
}
