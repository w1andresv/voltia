export const MAP_COLORS = {
  socHigh: "#3ddec8",
  socMid: "#d6b07e",
  socLow: "#d4776a",
  route: "#5ee6d4",
  mutedRoute: "#3a4654",
  /** Rutas alternativas (no seleccionadas) en el mapa. */
  alternative: "#8b98a8",
  origin: "#eef2f6",
  dest: "#3ddec8",
  charger: "#3ddec8",
  chargerIdle: "#8b98a8",
} as const;

export function socColor(soc: number): string {
  if (soc >= 40) return MAP_COLORS.socHigh;
  if (soc >= 18) return MAP_COLORS.socMid;
  return MAP_COLORS.socLow;
}
