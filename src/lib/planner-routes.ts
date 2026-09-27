/** Motor de planificación que elige la ruta: /v1 (actual) o /v2 (programación dinámica). */
export type PlannerEngine = "v1" | "v2";

/** Ruta del planificador para un motor; sin elección, el v1. */
export function plannerHref(engine: PlannerEngine | null | undefined): `/${PlannerEngine}` {
  return engine === "v2" ? "/v2" : "/v1";
}

/** Motor de una ruta del planificador, o null si la ruta no es del planificador. */
export function engineOfPath(pathname: string): PlannerEngine | null {
  if (pathname === "/v1" || pathname.startsWith("/v1/")) return "v1";
  if (pathname === "/v2" || pathname.startsWith("/v2/")) return "v2";
  return null;
}
