/** Motor de planificación que elige la ruta: /v1 (actual) o /v2 (programación dinámica). */
export type PlannerEngine = "v1" | "v2";

/** Ruta del planificador para un motor; sin elección, el v1. */
export function plannerHref(engine: PlannerEngine | null | undefined): `/${PlannerEngine}` {
  return engine === "v2" ? "/v2" : "/v1";
}

/** Motor de una ruta del planificador, o null si la ruta no es del planificador (p. ej. su guía). */
export function engineOfPath(pathname: string): PlannerEngine | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/v1") return "v1";
  if (path === "/v2") return "v2";
  return null;
}

/** Motor de una guía "Cómo funciona" (/v1/como-funciona, /v2/como-funciona), o null. */
export function guideEngineOfPath(pathname: string): PlannerEngine | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/v1/como-funciona") return "v1";
  if (path === "/v2/como-funciona") return "v2";
  return null;
}
