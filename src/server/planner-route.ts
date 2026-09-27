import "server-only";
import type { PlannerEngine } from "@/lib/planner-routes";

/** Motor que responde cuando el usuario no puede elegir: el configurado en el servidor. */
function serverEngine(plannerEngine: "legacy" | "shadow" | "v2"): PlannerEngine {
  return plannerEngine === "v2" ? "v2" : "v1";
}

/**
 * Motor que atiende la ruta /v1 o /v2 para quien la abre. Si ENGINE_PREVIEW_EMAILS
 * no le deja elegir, el servidor ignoraría la elección al planificar; la página
 * lo manda entonces a la ruta del motor configurado para no prometer otro.
 * Si falla la sesión (p. ej. Supabase mal configurado) cuenta como invitado.
 */
export async function plannerEngineFor(requested: PlannerEngine): Promise<PlannerEngine> {
  const { getEnv } = await import("@/infrastructure/config/env");
  const { getActor } = await import("@/infrastructure/auth/server-actor");
  const { canChooseEngine } = await import("@/infrastructure/auth/engine-preview");
  const actor = await getActor().catch(() => ({ role: "guest" as const, email: null }));
  return canChooseEngine(actor) ? requested : serverEngine(getEnv().PLANNER_ENGINE);
}

/** Ruta del planificador por defecto (enlaces viejos a /planificar). */
export async function defaultPlannerEngine(): Promise<PlannerEngine> {
  const { getEnv } = await import("@/infrastructure/config/env");
  return serverEngine(getEnv().PLANNER_ENGINE);
}
