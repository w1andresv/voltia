import type { DistanceMatrixProvider } from "@/domain/ports/distance-matrix";
import type { ElevationProvider } from "@/domain/ports/elevation";
import type { RoutingProvider } from "@/domain/ports/routing";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { WeatherProvider } from "@/domain/ports/weather";
import type { ModelParameters } from "@/domain/ev/core/params";
import {
  buildPlans,
  computePlans,
  rankVerifiedFirst,
  type EnergyEngine,
  type PlanInputs,
  type PlannerEngine,
} from "@/domain/ev/compute-plan";
import { rankPlans } from "@/domain/planner";
import { stationsNearRoutes } from "@/domain/ev/engines/corridor/engine";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import type { MeasuredDetour } from "@/domain/ev/contracts/detour";
import {
  ELEVATION_UNAVAILABLE_TEXT,
  type Charger,
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
  snapshotHash,
  type PlanningSnapshot,
  type VerifiedRoute,
} from "@/domain/ev/contracts/snapshot";
import {
  elevationSourceLabel,
  profileRoute,
  type ElevationReport,
  type ElevationSampling,
} from "./elevation-profile";
import { measureDetours } from "./detours";
import { selectRoutes } from "./route-selection";
import { buildEnergyShadowReport, formatEnergyShadowReport } from "./energy-shadow-report";
import { buildShadowReport, formatShadowReport } from "./shadow-report";
import { verifyPlanDetailed } from "./verify-plan";
import { withDeadline } from "./deadline";
import { weatherPointsAlong } from "@/domain/ev/engines/energy/weather-field";
import type { WeatherAlongRoute } from "@/domain/ev/contracts/weather";
import type { PlannerRunStats } from "@/domain/plan/shared";
import { checkStopDetails, offlineStopText } from "./stop-details";
import { formatStationFunnel, stationFunnel } from "./station-funnel";
import type { StationDetails } from "@/domain/ports/station-details";

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
  /** Detalle por estación (Blaze): se pide solo para las paradas del plan recomendado. */
  stationDetails?: StationDetails;
  /** Nombre de la fuente de estaciones en el snapshot; por defecto "dataset". */
  stationSource?: string;
  params: ModelParameters;
  engineMode: PlannerEngineMode;
  /** Modelo de energía; por defecto el actual. */
  energyMode?: EnergyEngineMode;
  /** Con él, los desvíos a las estaciones se miden por vía (DETOUR_SOURCE=matrix, F4). */
  detourMatrix?: DistanceMatrixProvider;
  /** Reloj inyectable (tests deterministas). */
  clock?: () => Date;
  /**
   * Corre trabajo que no cambia la respuesta (el modo sombra) después de responder.
   * Por defecto, enseguida; `container.ts` lo arma con `after()` de Next (ADR-0020).
   */
  defer?: (work: () => void) => void;
}

/** Vueltas de detalle de paradas: la del plan y, si cambió, la de las paradas nuevas. */
const STOP_DETAIL_ROUNDS = 2;

export interface PlanResult {
  response: PlanResponse & { geo: PlanningSnapshot };
  engine: RoutingEngine;
  chargerCount: number;
  /** Milisegundos por fase: rutas, datos, desvíos, cálculo, detalle de paradas y pasada 2. */
  timings: Record<string, number>;
  /** Lo que hizo el planificador v2 en la respuesta (estaciones, corridas del DP y contadores). */
  plannerStats: PlannerRunStats;
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
    const timings: Record<string, number> = {};
    let lapAt = Date.now();
    const lap = (phase: string) => {
      const now = Date.now();
      timings[phase] = (timings[phase] ?? 0) + (now - lapAt);
      lapAt = now;
    };
    const plannerStats: PlannerRunStats = { stations: 0, runs: 0, expansions: 0, arrivals: 0, labelWrites: 0 };
    const routed = await selectRoutes(routing, waypoints);
    lap("routes");
    const rawRoutes = routed.routes;
    warnings.push(...routed.warnings);
    const mid = rawRoutes[0]?.samples[Math.floor((rawRoutes[0].samples.length || 1) / 2)];
    const departAt = (this.deps.clock ?? (() => new Date()))();
    const [routes, snapshot, dataset, alongList] = await Promise.all([
      Promise.all(rawRoutes.map((route) => this.withElevation(route, elevationReports))),
      mid && weather ? weather.current(mid) : Promise.resolve(null),
      stations.getDataset(),
      // Clima por hora en varios puntos de cada ruta (solo se usa con la energía v2).
      Promise.all(rawRoutes.map((route) => this.weatherAlongRoute(route, departAt))),
    ]);
    const weatherAlong: Record<string, WeatherAlongRoute> = {};
    rawRoutes.forEach((route, i) => {
      const along = alongList[i];
      if (along) weatherAlong[route.id] = along;
    });
    lap("data");
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
    const corridor = stationsNearRoutes(
      dataset.stations,
      rawRoutes.map((r) => r.samples),
      params.corridor.maxFromRouteKm,
    );
    let chargers = corridor.filter((s) => s.planning.eligible).map(toPlanningCharger);
    const planVehicle = data.vehicle as Vehicle;
    console.log(
      formatStationFunnel(
        stationFunnel(dataset.stations.length, corridor, planVehicle),
        this.deps.stationSource ?? "dataset",
        `${planVehicle.brand} ${planVehicle.model}`,
        params.corridor.maxFromRouteKm,
      ),
    );

    const mode = this.deps.engineMode;
    lap("corridor");
    const detours = this.deps.detourMatrix
      ? await this.measure(this.deps.detourMatrix, routes, chargers, data.vehicle as Vehicle)
      : undefined;
    lap("detours");
    let inputs: PlanInputs = {
      routes,
      chargers,
      weather: snapshot,
      origin: data.origin,
      destination: data.destination,
      ...(detours ? { detours } : {}),
      ...(Object.keys(weatherAlong).length ? { weatherAlong } : {}),
      ...(elevationUnavailable ? { dataQuality: { elevation: "unavailable" as const } } : {}),
      params,
      stats: plannerStats,
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
    lap("compute");
    // La sombra no cambia la respuesta: corre después de responder, sobre lo ya calculado.
    const defer = this.deps.defer ?? ((work: () => void) => work());
    const shadowInputs: PlanInputs = { ...inputs, stats: undefined };
    const shadowRanked = ranked;
    if (mode === "shadow") {
      defer(() =>
        logShadow(trip, shadowRanked, conditions.planningMode, () =>
          buildPlans(shadowInputs, vehicle, conditions, "v2", energy),
        ),
      );
    }
    if (energyMode === "shadow") {
      defer(() =>
        logEnergyShadow(trip, shadowRanked, () =>
          buildPlans(shadowInputs, vehicle, conditions, responding, "v2"),
        ),
      );
    }
    // Detalle de las paradas (Blaze): si cambia algo (p. ej. una fuera de servicio), se
    // replanifica y se consultan también las paradas nuevas, una vuelta más como mucho.
    if (this.deps.stationDetails) {
      const checked = new Set<string>();
      const offline: string[] = [];
      for (let round = 1; round <= STOP_DETAIL_ROUNDS; round++) {
        const plan = ranked[0];
        if (!plan?.stops.some((s) => !checked.has(s.charger.id))) break;
        console.log(
          `[blaze] detalle de las paradas del plan recomendado${round > 1 ? " (paradas nuevas)" : ""}: ` +
            plan.stops
              .filter((s) => !checked.has(s.charger.id))
              .map((s) => `${s.charger.id} ${s.charger.name}`)
              .join(" · "),
        );
        const check = await checkStopDetails(
          this.deps.stationDetails,
          plan,
          chargers,
          undefined,
          checked,
        );
        for (const id of check.checkedIds) checked.add(id);
        console.log(
          `[stations:detail] ${check.requested} parada(s) consultadas, ${check.changed} con cambios, ` +
            `${check.offline.length} fuera de servicio${check.failed ? `, ${check.failed} sin respuesta` : ""}`,
        );
        if (!check.changed) break;
        chargers = check.chargers;
        inputs = { ...inputs, chargers };
        ({ plans: ranked, selectedId } = computePlans(
          inputs,
          vehicle,
          conditions,
          responding,
          energy,
        ));
        offline.push(...check.offline.map((c) => c.name));
      }
      if (offline.length) warnings.push(offlineStopText(offline));
      lap("stopDetails");
    }
    // Pasada 2 solo con el v2: una a tres rutas más por plan, y solo para el recomendado.
    // La ruta verificada queda en el snapshot: el navegador recalcula sobre ella al cambiar condiciones.
    let verifiedRoutes: PlanningSnapshot["verifiedRoutes"];
    if (mode === "v2" && ranked[0]?.stops.length) {
      const first = ranked[0];
      // Con plazo: si la pasada 2 se demora, se responde con la pasada 1 marcada `failed`.
      const out = await withDeadline(
        verifyPlanDetailed(
          {
            routing,
            withElevation: (r) => this.withElevation(r),
            maxIterations: params.planner.maxVerifyIterations,
          },
          {
            plan: first,
            inputs,
            userWaypoints: data.waypoints,
            vehicle,
            conditions,
            engine: "v2",
            energyEngine: energy,
          },
        ),
        params.planner.verifyBudgetMs,
        () => {
          console.warn(`[plan-trip:verify] sin respuesta en ${params.planner.verifyBudgetMs} ms: se usa la pasada 1`);
          return {
            plan: {
              ...first,
              verification: { status: "failed" as const, iterations: 0, baseDistanceKm: first.distanceKm },
            },
          };
        },
      );
      lap("verify");
      const verified = out.plan;
      if (out.route && verified.verification && verified.verification.status !== "failed") {
        verifiedRoutes = {
          [verified.id]: {
            route: out.route,
            chargerIds: out.chargerIds ?? null,
            verification: verified.verification,
          },
        };
      }
      const describe = (p: RoutePlan) =>
        `${p.stops.map((s) => s.charger.name).join(" · ") || "sin paradas"}` +
        (p.departureCharge ? ` (+${p.departureCharge.additionalPct} % antes de salir)` : "") +
        (p.feasible ? "" : " (no viable)");
      console.log(
        `[plan-trip:verify] ${verified.verification?.status ?? "sin paradas"} en ${verified.verification?.iterations ?? 0} ruta(s):` +
          ` ${describe(ranked[0])} → ${describe(verified)}, ${ranked[0].distanceKm.toFixed(1)} → ${verified.distanceKm.toFixed(1)} km`,
      );
      ranked = rankVerifiedFirst([verified, ...ranked.slice(1)], conditions.planningMode);
      selectedId = ranked[0]?.id ?? "";
    }

    const geoBody = {
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
        stations: this.deps.stationSource ?? "dataset",
      },
      routes,
      chargers,
      weather: snapshot,
      stationsVersion: dataset.version,
      ...(elevationUnavailable ? { dataQuality: { elevation: "unavailable" as const } } : {}),
      ...(detours ? { detours } : {}),
      // Solo con la energía v2: la v1 no lo usa y el snapshot no carga datos de más.
      ...(energy === "v2" && Object.keys(weatherAlong).length ? { weatherAlong } : {}),
    };
    const snapshotId = snapshotHash(geoBody);
    return {
      response: {
        geo: {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          createdAt: (this.deps.clock ?? (() => new Date()))().toISOString(),
          snapshotId,
          ...geoBody,
          warnings,
          ...(verifiedRoutes ? { verifiedRoutes } : {}),
        },
        plans: ranked.map((p) => ({ ...p, snapshotId })),
        selectedId,
      },
      engine: routed.engine,
      chargerCount: chargers.length,
      timings,
      plannerStats,
    };
  }

  /** Desvíos medidos por vía; si la matriz falla, los desvíos quedan estimados. */
  private async measure(
    matrix: DistanceMatrixProvider,
    routes: RawRoute[],
    chargers: Charger[],
    vehicle: Vehicle,
  ): Promise<Record<string, MeasuredDetour> | undefined> {
    const t0 = Date.now();
    try {
      const { detours, report } = await measureDetours(
        matrix,
        routes,
        chargers,
        vehicle,
        this.deps.params,
      );
      console.log(
        `[detours] ${report.measured} desvíos medidos en ${report.requests} consulta(s) de matriz, ${Date.now() - t0} ms` +
          (report.failedBatches
            ? ` (${report.failedBatches} lote(s) fallaron: quedan estimados)`
            : ""),
      );
      return Object.keys(detours).length ? detours : undefined;
    } catch (error) {
      console.error(
        "[detours] la matriz falló; desvíos estimados:",
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
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
      ...(snapshot.weatherAlong ? { weatherAlong: snapshot.weatherAlong } : {}),
      origin: request.origin,
      destination: request.destination,
      detours: snapshot.detours,
      ...(snapshot.dataQuality ? { dataQuality: snapshot.dataQuality } : {}),
      params,
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

  /**
   * Clima por hora en varios puntos de la ruta (M3.1). Solo si hace falta (energía v2 o sombra
   * de energía) y el proveedor lo tiene; si no responde, el plan sigue con el clima de un punto.
   */
  private async weatherAlongRoute(
    route: RawRoute,
    departAt: Date,
  ): Promise<WeatherAlongRoute | undefined> {
    const { weather, params } = this.deps;
    // Solo la energía v2 lo usa (también en su modo sombra).
    const energyV2 = this.deps.energyMode === "v2" || this.deps.energyMode === "shadow";
    if (!weather?.along || !energyV2) return undefined;
    const cfg = params.weather.alongRoute;
    const points = weatherPointsAlong(route, cfg.spacingKm, cfg.maxPoints);
    if (!points.length) return undefined;
    try {
      const series = await weather.along(points, cfg.hours);
      if (!series || series.length !== points.length) return undefined;
      return {
        departIso: departAt.toISOString(),
        source: weather.id,
        points: series.map((s, i) => ({ ...s, km: points[i]!.km })),
      };
    } catch {
      return undefined;
    }
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
