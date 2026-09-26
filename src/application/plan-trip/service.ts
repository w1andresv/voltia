import type { ElevationProvider } from "@/domain/ports/elevation";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { ModelParameters } from "@/domain/ev/core/params";
import {
  buildPlans,
  computePlans,
  type EnergyEngine,
  type PlanInputs,
  type PlannerEngine,
} from "@/domain/ev/compute-plan";
import { rankPlans } from "@/domain/planner";
import { stationsNearRoutes } from "@/domain/ev/engines/corridor/engine";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import {
  ELEVATION_UNAVAILABLE_TEXT,
  type PlanRequest,
  type PlanResponse,
  type RawRoute,
  type RoutePlan,
  type RoutingEngine,
  type TripConditions,
  type Vehicle,
} from "@/domain/types";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type PlanningSnapshot,
  type VerifiedRoute,
} from "@/domain/ev/contracts/snapshot";
import {
  elevationSourceLabel,
  profileRoute,
  type ElevationReport,
  type ElevationSampling,
} from "./elevation-profile";
import { selectRoutes } from "./route-selection";
import { buildEnergyShadowReport, formatEnergyShadowReport } from "./energy-shadow-report";
import { buildShadowReport, formatShadowReport } from "./shadow-report";
import { verifyPlan, verifyPlanDetailed } from "./verify-plan";

/**
 * `legacy`: planificador actual. `v2`: planificador por programación dinámica (F7).
 * `shadow`: calcula los dos, responde con el actual y registra las diferencias (plan §6).
 */
export type PlannerEngineMode = "legacy" | "shadow" | "v2";

/** Mismo esquema para el modelo de energía (ENERGY_ENGINE, F5). */
export type EnergyEngineMode = "legacy" | "shadow" | "v2";

export interface PlanningDeps {
  routing: RoutingProvider;
  elevation: ElevationProvider;
  /** Cómo muestrear la elevación (ELEVATION_SOURCE); por defecto la fija de siempre. */
  elevationSampling?: ElevationSampling;
  /** Respaldo si `elevation` falla (con la estrategia fija). */
  elevationFallback?: ElevationProvider;
  weather: WeatherProvider | null;
  stations: StationCatalog;
  params: ModelParameters;
  engineMode: PlannerEngineMode;
  /** Modelo de energía; por defecto el actual. */
  energyMode?: EnergyEngineMode;
  /** Reloj inyectable (tests deterministas). */
  clock?: () => Date;
}

export interface PlanResult {
  response: PlanResponse & { geo: PlanningSnapshot };
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
    if (process.env.NODE_ENV === "production")
      console.log("[plan-trip:shadow]", JSON.stringify(report));
    else console.log(formatShadowReport(report));
  } catch (error) {
    console.error(
      "[plan-trip:shadow] v2 falló",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Modo sombra de energía: mismo planificador con el modelo actual y el v2. Un error del v2 solo se registra. */
function logEnergyShadow(trip: string, current: RoutePlan[], runV2: () => RoutePlan[]): void {
  try {
    const t0 = Date.now();
    const v2 = runV2();
    const report = buildEnergyShadowReport({ trip, ms: Date.now() - t0, legacy: current, v2 });
    if (process.env.NODE_ENV === "production")
      console.log("[plan-trip:energy-shadow]", JSON.stringify(report));
    else console.log(formatEnergyShadowReport(report));
  } catch (error) {
    console.error(
      "[plan-trip:energy-shadow] v2 falló",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Una línea por planificación: fuente, puntos, tiempo y desnivel de cada ruta (para comparar fuentes). */
function logElevation(reports: ElevationReport[], routes: RawRoute[]): void {
  if (!reports.length) return;
  const parts = reports.map((r, i) => {
    const e = routes[i]?.elevation;
    const stats = e ? ` ↑${Math.round(e.gainM)} ↓${Math.round(e.lossM)} m` : "";
    return `${r.source ?? "sin elevación"} ${r.points} pts ${r.ms} ms${stats}${r.error ? ` (falló el principal: ${r.error})` : ""}`;
  });
  console.log(`[elevation] ${parts.join(" | ")}`);
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
    const elevationReports: ElevationReport[] = [];
    const routed = await selectRoutes(routing, waypoints);
    const rawRoutes = routed.routes;
    warnings.push(...routed.warnings);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    const [routes, snapshot, dataset] = await Promise.all([
      Promise.all(rawRoutes.map((route) => this.withElevation(route, elevationReports))),
      mid && weather ? weather.current(mid) : Promise.resolve(null),
      stations.getDataset(),
    ]);
    logElevation(elevationReports, routes);
    // Error de datos (F2b): ninguna fuente de elevación respondió para una ruta de más de 5 km.
    const elevationUnavailable = elevationReports.some(
      (r, i) => r.errorCode === "ELEVATION_UNAVAILABLE" && (routes[i]?.distanceKm ?? 0) > 5,
    );
    if (elevationUnavailable) warnings.push(ELEVATION_UNAVAILABLE_TEXT);
    for (const s of dataset.sources) {
      if (s.stale)
        warnings.push(
          `Electrolineras de ${s.id}: usando el último dato disponible (fuente lenta o caída).`,
        );
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
    const energyMode = this.deps.energyMode ?? "legacy";
    const energy: EnergyEngine = energyMode === "v2" ? "v2" : "legacy";
    const trip = `${data.origin.label} → ${data.destination.label}`;
    let { plans: ranked, selectedId } = computePlans(
      inputs,
      vehicle,
      conditions,
      responding,
      energy,
    );
    if (mode === "shadow") {
      logShadow(trip, ranked, conditions.planningMode, () =>
        buildPlans(inputs, vehicle, conditions, "v2", energy),
      );
    }
    if (energyMode === "shadow") {
      logEnergyShadow(trip, ranked, () =>
        buildPlans(inputs, vehicle, conditions, responding, "v2"),
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
        {
          plan: ranked[0],
          inputs,
          userWaypoints: data.waypoints,
          vehicle,
          conditions,
          engine: "v2",
          energyEngine: energy,
        },
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
        geo: {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          createdAt: (this.deps.clock ?? (() => new Date()))().toISOString(),
          modelVersion: params.modelVersion,
          plannerEngine: responding,
          energyEngine: energy,
          providers: {
            routing: routed.engine,
            // La fuente que de verdad dio el perfil (con respaldo puede no ser la configurada).
            elevation:
              [...new Set(elevationReports.map((r) => r.source ?? "ninguna"))].join(",") ||
              elevationSourceLabel(this.deps.elevation, this.deps.elevationSampling ?? "fixed"),
            weather: weather?.id ?? null,
            stations: "dataset",
          },
          routes,
          chargers,
          weather: snapshot,
          warnings,
          stationsVersion: dataset.version,
          ...(elevationUnavailable ? { dataQuality: { elevation: "unavailable" as const } } : {}),
        },
        plans: ranked,
        selectedId,
      },
      engine: routed.engine,
      chargerCount: chargers.length,
    };
  }

  /**
   * Pasada 2 sobre un viaje guardado (D6: al compartir). Verifica el plan
   * recomendado del snapshot y devuelve la ruta real para guardarla con el
   * viaje; null si no tiene paradas o no se pudo verificar.
   */
  async verifySnapshot(
    snapshot: PlanningSnapshot,
    request: PlanRequest,
  ): Promise<Record<string, VerifiedRoute> | null> {
    const { routing, params } = this.deps;
    const vehicle = request.vehicle as Vehicle;
    const conditions = request.conditions as TripConditions;
    const inputs: PlanInputs = {
      routes: snapshot.routes,
      chargers: snapshot.chargers,
      weather: snapshot.weather,
      origin: request.origin,
      destination: request.destination,
    };
    const energyEngine = snapshot.energyEngine ?? "legacy";
    const [plan] = computePlans(
      inputs,
      vehicle,
      conditions,
      snapshot.plannerEngine,
      energyEngine,
    ).plans;
    if (!plan?.stops.length) return null;
    const out = await verifyPlanDetailed(
      {
        routing,
        withElevation: (r) => this.withElevation(r),
        maxIterations: params.planner.maxVerifyIterations,
      },
      {
        plan,
        inputs,
        userWaypoints: request.waypoints,
        vehicle,
        conditions,
        engine: snapshot.plannerEngine,
        energyEngine,
      },
    );
    if (!out.route || !out.plan.verification || out.plan.verification.status === "failed")
      return null;
    return {
      [plan.id]: {
        route: out.route,
        chargerIds: out.chargerIds ?? null,
        verification: out.plan.verification,
      },
    };
  }

  /** Elevación de una ruta. Si ningún proveedor responde, la ruta sigue plana y el plan lo avisa. */
  private async withElevation(route: RawRoute, reports?: ElevationReport[]): Promise<RawRoute> {
    const { elevation, elevationSampling, elevationFallback, params } = this.deps;
    const out = await profileRoute(
      route,
      { provider: elevation, sampling: elevationSampling ?? "fixed", fallback: elevationFallback },
      params.elevation,
    );
    reports?.push(out.report);
    return out.route;
  }
}
