import { redirect } from "next/navigation";
import { connection } from "next/server";
import { plannerHref } from "@/lib/planner-routes";
import { defaultPlannerEngine } from "@/server/planner-route";

// El planificador vive en /v1 y /v2 (una ruta por motor) y "/" es el landing.
// /planificar queda para no partir enlaces viejos: lleva al motor configurado
// en el servidor, leído en cada visita (no al compilar).
export default async function PlanPage(): Promise<never> {
  await connection();
  redirect(plannerHref(await defaultPlannerEngine()));
}
