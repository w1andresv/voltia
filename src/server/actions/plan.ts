"use server";

import type { Place, PlanRequest, PlanResponse } from "@/domain/types";
import { PlanRequestSchema } from "@/domain/schemas";
import { checkRateLimit, getClientIp } from "@/infrastructure/rate-limit";

const PlanSchema = PlanRequestSchema;

export async function reversePlaceFn(input: {
  data: { lat: number; lon: number };
}): Promise<Place> {
  const { createGeocoder } = await import("@/application/container");
  return createGeocoder().reverse({ lat: input.data.lat, lon: input.data.lon });
}

/** v1: planificador y energía actuales. v2: planificador por programación dinámica y energía física (F5, F7). */
export type EngineChoice = "v1" | "v2";

/** Motores de planificación y energía según la elección, solo si el usuario puede elegir. */
async function engineOverrides(choice: unknown) {
  if (choice !== "v1" && choice !== "v2") return {};
  const { getActor } = await import("@/infrastructure/auth/server-actor");
  const { canChooseEngine } = await import("@/infrastructure/auth/engine-preview");
  if (!canChooseEngine(await getActor())) return {};
  return choice === "v2"
    ? ({ engineMode: "v2", energyMode: "v2" } as const)
    : ({ engineMode: "legacy", energyMode: "legacy" } as const);
}

export async function planTripFn(input: {
  data: PlanRequest;
  engine?: EngineChoice;
}): Promise<PlanResponse> {
  const ip = await getClientIp();
  // 20 planificaciones/min por IP: protege las cuotas de OSRM/Overpass, que
  // son gratis y compartidas con otros usuarios de esas APIs públicas.
  await checkRateLimit("plan-trip", ip, 20, 60);
  const data = PlanSchema.parse(input.data);
  const startedAt = Date.now();

  try {
    const { createPlanningService } = await import("@/application/container");
    const overrides = await engineOverrides(input.engine);
    const { response, engine, chargerCount, timings, plannerStats } =
      await createPlanningService(overrides).plan(data);

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
        // Milisegundos por fase y trabajo del planificador v2 (ADR-0020).
        phases: timings,
        planner: plannerStats,
        ...(overrides.engineMode ? { engineChoice: input.engine } : {}),
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
