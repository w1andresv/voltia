import type { NormalizedRecord, StationConnector } from "@/domain/stations/model";
import { currentFromStandard } from "@/domain/stations/connectors";
import { CATALOG_CHARGERS } from "@/infrastructure/providers/chargers.catalog";
import type { StationSource } from "./types";

/**
 * La potencia del catálogo es una suposición del operador, no un reporte
 * confirmado: se guarda en attributes como referencia, pero el conector sale
 * con powerKw null y confirmed false (merge.ts / eligibility.ts deciden el resto).
 */
function toConnectors(sockets: { connector: string; powerKw: number; count: number }[]): StationConnector[] {
  return sockets.map((s) => ({
    standard: s.connector as StationConnector["standard"],
    rawLabel: s.connector,
    quantity: s.count,
    powerKw: null,
    current: currentFromStandard(s.connector as StationConnector["standard"]),
    currentOrigin: "standard",
    voltageV: null,
    amperageA: null,
    status: "unknown",
    confirmed: false,
    sources: ["catalog"],
  }));
}

export const catalogSource: StationSource = {
  id: "catalog",
  label: "Catálogo del operador",
  enabled: () => true,
  timeoutMs: 1000,
  ttlMs: Infinity, // estático, en memoria: no tiene sentido "refrescarlo"

  async fetchAll(): Promise<NormalizedRecord[]> {
    return CATALOG_CHARGERS.map((c) => ({
      source: "catalog",
      externalId: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      address: c.address ? { full: c.address } : undefined,
      operator: c.operator,
      openingHours: c.openingHours,
      access: c.access === "public" ? "public" : undefined,
      services: [],
      availability: { value: "unknown" },
      connectors: toConnectors(c.sockets),
      attributes: {
        assumedSocketsJson: JSON.stringify(c.sockets),
        notes: c.notes ?? "",
      },
      url: c.url,
    }));
  },
};
