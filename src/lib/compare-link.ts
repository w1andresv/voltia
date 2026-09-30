/** Pantalla de la comparativa de vehículos en la ruta del plan (app/comparar). */
export const COMPARE_PATH = "/comparar";
/** Vehículos que se comparan además del elegido en el plan. */
export const MAX_COMPARED = 2;

export function compareHref(vehicleIds: string[]): string {
  const ids = vehicleIds.slice(0, MAX_COMPARED).map(encodeURIComponent).join(",");
  return `${COMPARE_PATH}?vehiculos=${ids}`;
}

/**
 * Los vehículos a comparar según `?vehiculos=`: sin repetir, sin el del plan y
 * como mucho `MAX_COMPARED` (el enlace se puede editar a mano).
 */
export function parseCompareIds(param: string | null, currentId: string): string[] {
  const ids = (param ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id && id !== currentId);
  return [...new Set(ids)].slice(0, MAX_COMPARED);
}
