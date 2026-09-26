import type { ElevationProvider } from "@/domain/ports/elevation";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { ModelParameters } from "@/domain/ev/core/params";
import { applyElevationProfile, elevationProbes } from "@/domain/ev/engines/elevation/engine";
import { buildPlans, computePlans, type PlanInputs, type PlannerEngine } from "@/domain/ev/compute-plan";
import { rankPlans } from "@/domain/planner";
import { stationsNearRoutes } from "@/domain/ev/engines/corridor/engine";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import type { PlanRequest, PlanResponse, RawRoute, RoutePlan, RoutingEngine, TripConditions, Vehicle } from "@/domain/types";
import { selectRoutes } from "./route-selection";
import { buildShadowReport, formatShadowReport } from "./shadow-report";
import { verifyPlan } from "./verify-plan";

/**
 * `legacy`: planificador actual. `v2`: planificador por programación dinámica (F7).
 * `shadow`: calcula los dos, responde con el actual y registra las diferencias (plan §6).
 */
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
 * Modo sombra: el planificador v2 corre al lado del actual y se registra en qué
 * difieren, sin afectar la respuesta. En desarrollo como tabla legible; en
 * producción como JSON de una línea. Un error del v2 solo se registra.
 */
function logShadow(
  trip: string,
  legacy: RoutePlan[],
  mode: TripConditions["planningMode"],
  runV2: () => RoutePlan[],
): void {
  try {
    const t0 = Date.now();
    const v2 = runV2();
    const report = buildShadowReport({
      trip,
      mode,
      ms: Date.now() - t0,
      legacy,
      v2,
      selected: [rankPlans(legacy, mode)[0]?.id, rankPlans(v2, mode)[0]?.id],
    });
    if (process.env.NODE_ENV === "production") console.log("[plan-trip:shadow]", JSON.stringify(report));
    else console.log(formatShadowReport(report));
  } catch (error) {
    console.error("[plan-trip:shadow] v2 falló", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Caso de uso "planificar un viaje": reúne los datos por los puertos y compone
 * el plan. No conoce a Mapbox, Open-Meteo ni Postgres (eso lo arma container.ts).
 */
export class EVRoutePlanningService {
  constructor(private readonly deps: PlanningDeps) {}

  async plan(data: PlanRequest): Promise<PlanResult> {
    const { routing, weather, stations, params } = this.deps;
    const waypoints = [data.origin, ...data.waypoints, data.destination];
    const warnings: string[] = [];
    const routed = await selectRoutes(routing, waypoints);
    const rawRoutes = routed.routes;
    warnings.push(...routed.warnings);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    const [routes, snapshot, dataset] = await Promise.all([
      Promise.all(rawRoutes.map((route) => this.withElevation(route))),
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
    // Cargadores a lo largo de TODAS las rutas (no solo la primera): así cada
    // alternativa puede planear sus paradas. Cada ruta se evalúa por separado.
    const chargers = stationsNearRoutes(
      dataset.stations,
      rawRoutes.map((r) => r.samples),
      params.corridor.maxFromRouteKm,
    )
      .filter((s) => s.planning.eligible)
      .map(toPlanningCharger);

    const mode = this.deps.engineMode;
    const inputs: PlanInputs = {
      routes,
      chargers,
      weather: snapshot,
      origin: data.origin,
      destination: data.destination,
    };
    const vehicle = data.vehicle as Vehicle;
    const conditions = data.conditions as TripConditions;
    const responding: PlannerEngine = mode === "v2" ? "v2" : "legacy";
    let { plans: ranked, selectedId } = computePlans(inputs, vehicle, conditions, responding);
    if (mode === "shadow") {
      logShadow(`${data.origin.label} → ${data.destination.label}`, ranked, conditions.planningMode, () =>
        buildPlans(inputs, vehicle, conditions, "v2"),
      );
    }
    // Pasada 2 solo con el v2: una a tres rutas más por plan, y solo para el recomendado.
    if (mode === "v2" && ranked[0]?.stops.length) {
      const verified = await verifyPlan(
        {
          routing,
          withElevation: (r) => this.withElevation(r),
          maxIterations: params.planner.maxVerifyIterations,
        },
        { plan: ranked[0], inputs, userWaypoints: data.waypoints, vehicle, conditions, engine: "v2" },
      );
      console.log(
        `[plan-trip:verify] ${verified.verification?.status ?? "sin paradas"} en ${verified.verification?.iterations ?? 0} ruta(s):` +
          ` ${ranked[0].stops.length} → ${verified.stops.length} paradas, ${ranked[0].distanceKm.toFixed(1)} → ${verified.distanceKm.toFixed(1)} km`,
      );
      ranked = rankPlans([verified, ...ranked.slice(1)], conditions.planningMode);
      selectedId = ranked[0]?.id ?? "";
    }

    return {
      response: {
        geo: { routes, chargers, weather: snapshot, warnings, stationsVersion: dataset.version, plannerEngine: responding },
        plans: ranked,
        selectedId,
      },
      engine: routed.engine,
      chargerCount: chargers.length,
    };
  }

  /** Elevación de una ruta. Si el proveedor no responde, la ruta sigue plana y el plan lo avisa. */
  private async withElevation(route: RawRoute): Promise<RawRoute> {
    const { elevation, params } = this.deps;
    const probes = elevationProbes(route, params.elevation);
    if (!probes) return route;
    try {
      const heights = await elevation.getElevations(probes);
      return applyElevationProfile(route, probes, heights, params.elevation);
    } catch {
      return route;
    }
  }
}
