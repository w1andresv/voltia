export type ColorScheme = "light" | "dark";

export const MAP_COLORS_DARK = {
  socHigh: "#2fcebb",
  socMid: "#e2b340",
  socLow: "#e15d5d",
  route: "#3ee0cc",
  mutedRoute: "#3a4450",
  alternative: "#8ea0b3",
  origin: "#f3f6f7",
  dest: "#2fcebb",
  charger: "#2fcebb",
  chargerIdle: "#8ea0b3",
  adapter: "#e2b340",
  slow: "#8ea0b3",
  ink: "#04221c",
  inkWarn: "#2a2114",
} as const;

export const MAP_COLORS_LIGHT = {
  socHigh: "#0f8f82",
  socMid: "#9a6b12",
  socLow: "#c24141",
  route: "#0f8f82",
  mutedRoute: "#c5ced6",
  alternative: "#8aa0b0",
  origin: "#1c242d",
  dest: "#0f766e",
  charger: "#0f766e",
  chargerIdle: "#8aa0b0",
  adapter: "#9a6b12",
  slow: "#5c6b78",
  ink: "#f4fffc",
  inkWarn: "#2a2114",
} as const;

export type MapPalette = typeof MAP_COLORS_DARK;

export const MAP_COLORS = MAP_COLORS_DARK;

export function mapPalette(scheme: ColorScheme): MapPalette {
  return scheme === "light" ? MAP_COLORS_LIGHT : MAP_COLORS_DARK;
}

export function socColor(soc: number, palette: MapPalette = MAP_COLORS): string {
  if (soc >= 40) return palette.socHigh;
  if (soc >= 18) return palette.socMid;
  return palette.socLow;
}
