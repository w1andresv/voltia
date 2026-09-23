import type { PlanRequestShape } from "@/domain/schemas";
import type { Vehicle } from "@/domain/types";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Huella de un vehículo: marca, modelo, versión, año, batería y autonomía. */
export function vehicleFingerprint(
  v: Pick<Vehicle, "brand" | "model" | "version" | "year" | "batteryKwh" | "rangeKm">,
): string {
  return [norm(v.brand), norm(v.model), norm(v.version), v.year, v.batteryKwh, v.rangeKm].join("|");
}

/** Redondeo a 3 decimales (~100 m). */
const coord = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

const point = (p: { lat: number; lon: number }) => `${coord(p.lat)},${coord(p.lon)}`;

/** Huella de una ruta: origen, destino, paradas, vehículo, modo e initialSoc. */
export function tripFingerprint(req: PlanRequestShape): string {
  return [
    point(req.origin),
    point(req.destination),
    req.waypoints.map(point).join(";"),
    req.vehicle.id,
    req.conditions.planningMode,
    req.conditions.initialSoc,
  ].join("|");
}
