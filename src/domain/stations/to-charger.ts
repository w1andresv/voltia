import type { ConsolidatedStation } from "./model";
import type { Charger, ChargerSocket, ChargerSource, ConnectorType } from "../types";

/** attributes/conflicts no hacen falta aquí: el listado liviano de /api/stations los omite. */
type StationForCharger = Omit<ConsolidatedStation, "attributes" | "conflicts">;

const PLANNING_STANDARDS = ["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"];

function toSockets(station: StationForCharger, onlyEligible: boolean): ChargerSocket[] {
  const sockets: ChargerSocket[] = [];
  for (const c of station.connectors) {
    if (!PLANNING_STANDARDS.includes(c.standard)) continue;
    if (onlyEligible && (c.powerKw == null || !c.confirmed)) continue;
    sockets.push({
      connector: c.standard as ConnectorType,
      powerKw: c.powerKw ?? 0,
      count: c.quantity ?? 1,
    });
  }
  return sockets;
}

/** ChargerSource no incluye "ocm" todavía: se muestra como si fuera OSM. */
function toChargerSource(station: StationForCharger): ChargerSource {
  return station.coordSource === "ocm" ? "osm" : (station.coordSource as ChargerSource);
}

function toChargerBase(station: StationForCharger, sockets: ChargerSocket[]): Omit<Charger, "verified"> {
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    operator: station.operator || station.network || station.brand,
    sockets,
    access: station.access,
    openingHours: station.openingHours,
    pricePerKwh: station.pricing?.perKwh,
    source: toChargerSource(station),
    available: station.availability.value === "available" ? true : station.availability.value === "occupied" || station.availability.value === "offline" ? false : null,
    availability: station.availability.value,
    address: station.address?.full,
    updatedAt: station.sources[0]?.sourceUpdatedAt || station.sources[0]?.fetchedAt,
    url: station.sources[0]?.url,
  };
}

/**
 * Convierte una ConsolidatedStation en el tipo Charger que requiere el motor de rutas.
 * Solo incluye los conectores elegibles (con potencia reportada y confirmados).
 */
export function toPlanningCharger(station: ConsolidatedStation): Charger {
  if (!station.planning.eligible) {
    throw new Error(`Intentando convertir estación no elegible: ${station.id}`);
  }
  return { ...toChargerBase(station, toSockets(station, true)), verified: true };
}

/**
 * Convierte una ConsolidatedStation para mostrarla en el mapa: incluye todos
 * los conectores (aunque no tengan potencia confirmada) — "se muestra en el
 * mapa" aunque no sirva para planificar (decisión 4 del plan).
 */
export function toDisplayCharger(station: StationForCharger): Charger {
  return { ...toChargerBase(station, toSockets(station, false)), verified: station.planning.eligible };
}
