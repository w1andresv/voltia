import type {
  ConsolidatedStation,
  ExtendedConnectorType,
  StationConnector,
} from "@/domain/stations/model";
import type { StationAvailability } from "@/domain/types";
import {
  currentFromStandard,
  defaultKwForStandard,
  standardizeConnector,
} from "@/domain/stations/connectors";
import { evaluateEligibility } from "@/domain/stations/eligibility";
import type { BlazeCharger, BlazeStation, BlazeStatus } from "./schemas";

/**
 * Capa anticorrupción (ADR-0008): de la respuesta de Blaze a los tipos del
 * dominio. Funciones puras; el dominio no sabe que Blaze existe.
 */

/** Prefijo de los ids de Blaze en la app, para no chocar con los del dataset consolidado. */
export const BLAZE_ID_PREFIX = "blz_";

export function blazeStationId(id: number | string): string {
  return `${BLAZE_ID_PREFIX}${id}`;
}

/** El id de Blaze a partir del de la app; null si la estación no es de Blaze. */
export function blazeExternalId(stationId: string): string | null {
  if (!stationId.startsWith(BLAZE_ID_PREFIX)) return null;
  const id = stationId.slice(BLAZE_ID_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** "en_servicio" es operativa, no "libre ahora": Blaze no publica ocupación. */
export function availabilityOf(status: BlazeStatus | null | undefined): StationAvailability {
  switch (status) {
    case "en_servicio":
      return "available";
    case "mantenimiento":
    case "fuera_servicio":
      return "offline";
    default:
      return "unknown";
  }
}

/** Blaze escribe los conectores en español y con variantes: "Tipo 2", "Tipo2", "CCS 2", "CCS-2". */
export function standardOf(label: string): ExtendedConnectorType {
  return standardizeConnector(
    label
      .replace(/\btipo[\s-]*(\d)/gi, "Type $1")
      .replace(/\btipo\b/gi, "Type")
      .replace(/\bccs[\s-]*([12])\b/gi, "CCS$1"),
  );
}

/** Potencia máxima típica de un conector de corriente alterna (Tipo 2 trifásico). */
const AC_MAX_KW = 43;

/**
 * Conectores del listado. El listado solo trae la potencia máxima de la
 * estación (`maxKw`), no la de cada conector:
 *  - si hay conectores de corriente continua, `maxKw` es la de ellos y los de
 *    alterna quedan con la potencia del estándar, acotada a `maxKw` ("assumed");
 *  - si solo hay alterna, `maxKw` es la de ellos (hasta 43 kW).
 * Sin `maxKw` (key sin chargers:read) todos quedan con la del estándar.
 */
export function connectorsFromList(station: BlazeStation): StationConnector[] {
  const labels = (station.connectors ?? "")
    .split(/[,;/|]/)
    .map((l) => l.trim())
    .filter(Boolean);
  const byStandard = new Map<ExtendedConnectorType, string>();
  for (const label of labels) {
    const standard = standardOf(label);
    if (!byStandard.has(standard)) byStandard.set(standard, label);
  }
  const maxKw = station.maxKw != null && station.maxKw > 0 ? station.maxKw : null;
  const hasDc = [...byStandard.keys()].some((s) => currentFromStandard(s) !== "AC");
  const single = byStandard.size === 1;
  return [...byStandard].map(([standard, rawLabel]) => {
    const isAc = currentFromStandard(standard) === "AC";
    const reported = maxKw != null && (isAc ? !hasDc && maxKw <= AC_MAX_KW : true);
    const fallback = defaultKwForStandard(standard);
    const powerKw = reported
      ? maxKw
      : fallback != null && maxKw != null
        ? Math.min(fallback, maxKw)
        : fallback;
    return connector(standard, rawLabel, {
      powerKw,
      powerOrigin: reported ? "reported" : powerKw != null ? "assumed" : null,
      quantity: single && station.chargersCount ? station.chargersCount : null,
      status: "unknown",
    });
  });
}

/** Conectores del detalle: uno por estándar, con la cantidad y el estado de sus cargadores. */
export function connectorsFromChargers(chargers: BlazeCharger[]): StationConnector[] {
  const groups = new Map<ExtendedConnectorType, BlazeCharger[]>();
  for (const c of chargers) {
    const standard = standardOf(c.connectorType ?? "");
    groups.set(standard, [...(groups.get(standard) ?? []), c]);
  }
  return [...groups].map(([standard, list]) => {
    const powers = list.map((c) => c.powerKw).filter((p): p is number => p != null && p > 0);
    const powerKw = powers.length ? Math.max(...powers) : defaultKwForStandard(standard);
    return connector(standard, list[0]?.connectorType ?? "", {
      powerKw,
      powerOrigin: powers.length ? "reported" : powerKw != null ? "assumed" : null,
      quantity: list.length,
      status: groupStatus(list.map((c) => availabilityOf(c.status))),
    });
  });
}

/** Un conector sirve si al menos un cargador está en servicio. */
function groupStatus(statuses: StationAvailability[]): StationAvailability {
  if (statuses.includes("available")) return "available";
  if (statuses.length && statuses.every((s) => s === "offline")) return "offline";
  return "unknown";
}

function connector(
  standard: ExtendedConnectorType,
  rawLabel: string,
  fields: Pick<StationConnector, "powerKw" | "powerOrigin" | "quantity" | "status">,
): StationConnector {
  const current = currentFromStandard(standard);
  return {
    standard,
    rawLabel,
    current,
    currentOrigin: current ? "standard" : null,
    voltageV: null,
    amperageA: null,
    // Blaze es la fuente oficial del operador: sus conectores cuentan como confirmados.
    confirmed: true,
    sources: ["blaze"],
    ...fields,
  };
}

/**
 * Una estación de Blaze como estación consolidada. null sin coordenadas
 * (la key no tiene location:read): no se puede ubicar en el mapa ni en la ruta.
 */
export function toConsolidatedStation(
  station: BlazeStation,
  fetchedAt: string,
): ConsolidatedStation | null {
  if (station.lat == null || station.lon == null) return null;
  const connectors = station.chargers?.length
    ? connectorsFromChargers(station.chargers)
    : connectorsFromList(station);
  const statusFromChargers = station.chargers?.length
    ? groupStatus(connectors.map((c) => c.status))
    : null;
  const listed = availabilityOf(station.status);
  // El detalle manda: si ningún cargador está en servicio, la estación no sirve.
  const availability = statusFromChargers === "offline" ? "offline" : listed;
  const attributes: Record<string, string | number | boolean> = {};
  if (station.verified != null) attributes.verified = station.verified;
  if (station.status) attributes.status = station.status;
  if (station.chargersCount != null) attributes.chargersCount = station.chargersCount;
  if (station.maxKw != null) attributes.maxKw = station.maxKw;

  const base: ConsolidatedStation = {
    id: blazeStationId(station.id),
    name: station.name,
    aliases: [],
    lat: station.lat,
    lon: station.lon,
    coordSource: "blaze",
    ...(station.address || station.city
      ? {
          address: {
            ...(station.address ? { full: station.address } : {}),
            ...(station.city ? { city: station.city } : {}),
          },
        }
      : {}),
    ...(station.operator ? { operator: station.operator } : {}),
    access: "public",
    services: [],
    availability: { value: availability, source: "blaze", at: fetchedAt },
    connectors,
    sources: [{ source: "blaze", externalId: String(station.id), fetchedAt }],
    attributes: { blaze: attributes },
    conflicts: [],
    planning: { eligible: false, reasons: [] },
  };
  return { ...base, planning: evaluateEligibility(base) };
}
