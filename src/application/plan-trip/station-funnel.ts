import { routeSocket } from "@/domain/ev/engines/compatibility/engine";
import type { ConsolidatedStation } from "@/domain/stations/model";
import { toPlanningCharger } from "@/domain/stations/to-charger";
import { isVerifiedForPlanning, type Charger, type Vehicle } from "@/domain/types";

/**
 * Cuántas estaciones sobreviven a cada filtro antes del planificador, y por
 * qué se descartó cada una. Sirve para diagnosticar "pasa por una estación y
 * no para" (auditoría 2026-09-27): el log dice en qué filtro se cayó.
 */
export interface StationFunnel {
  listed: number;
  corridor: number;
  eligible: number;
  verified: number;
  compatible: number;
  inService: number;
  /** Las que llegan al planificador. */
  usable: { id: string; name: string }[];
  discarded: { id: string; name: string; reason: string }[];
}

function isOffline(c: Charger): boolean {
  return c.availability === "offline" || c.available === false;
}

export function stationFunnel(
  listed: number,
  corridor: ConsolidatedStation[],
  vehicle: Vehicle,
): StationFunnel {
  const discarded: StationFunnel["discarded"] = [];
  const eligible = corridor.filter((s) => {
    if (s.planning.eligible) return true;
    discarded.push({
      id: s.id,
      name: s.name,
      reason: `no elegible: ${s.planning.reasons.join(", ") || "sin motivo"}`,
    });
    return false;
  });
  const chargers = eligible.map(toPlanningCharger);
  const verified = chargers.filter((c) => {
    if (isVerifiedForPlanning(c)) return true;
    discarded.push({
      id: c.id,
      name: c.name,
      reason: `no verificada para planificar (fuente "${c.source}")`,
    });
    return false;
  });
  const compatible = verified.filter((c) => {
    if (routeSocket(c, vehicle)) return true;
    const sockets = [...new Set(c.sockets.map((s) => s.connector))].join(", ") || "ninguno";
    discarded.push({
      id: c.id,
      name: c.name,
      reason: `sin conector compatible (tiene ${sockets})`,
    });
    return false;
  });
  const inService = compatible.filter((c) => {
    if (!isOffline(c)) return true;
    discarded.push({ id: c.id, name: c.name, reason: "fuera de servicio" });
    return false;
  });
  return {
    listed,
    corridor: corridor.length,
    eligible: eligible.length,
    verified: verified.length,
    compatible: compatible.length,
    inService: inService.length,
    usable: inService.map((c) => ({ id: c.id, name: c.name })),
    discarded,
  };
}

export function formatStationFunnel(
  f: StationFunnel,
  source: string,
  vehicleLabel: string,
  corridorKm: number,
): string {
  const head =
    `[plan-trip:stations] ${source}: ${f.listed} en el listado → ${f.corridor} a ≤ ${corridorKm} km de la ruta → ` +
    `${f.eligible} elegibles → ${f.verified} aceptadas → ${f.compatible} compatibles con ${vehicleLabel} → ${f.inService} en servicio`;
  const lines = [head];
  if (f.usable.length)
    lines.push(`  para planificar: ${f.usable.map((u) => `${u.id} ${u.name}`).join(" · ")}`);
  if (f.discarded.length)
    lines.push(
      `  descartadas: ${f.discarded.map((d) => `${d.id} ${d.name} (${d.reason})`).join(" · ")}`,
    );
  return lines.join("\n");
}
