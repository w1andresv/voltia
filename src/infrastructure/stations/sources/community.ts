import type { NormalizedRecord, StationConnector } from "@/domain/stations/model";
import { currentFromStandard } from "@/domain/stations/connectors";
import { loadCommunityChargers } from "@/server/actions/stations-db";
import type { StationSource } from "./types";

function toConnectors(sockets: { connector: string; powerKw: number; count: number }[]): StationConnector[] {
  return sockets.map((s) => ({
    standard: s.connector as StationConnector["standard"],
    rawLabel: s.connector,
    quantity: s.count,
    powerKw: s.powerKw,
    current: currentFromStandard(s.connector as StationConnector["standard"]),
    currentOrigin: "standard",
    voltageV: null,
    amperageA: null,
    status: "unknown",
    confirmed: true,
    sources: ["community"],
  }));
}

export const communitySource: StationSource = {
  id: "community",
  label: "Comunidad",
  enabled: () => true,
  timeoutMs: 5000,
  ttlMs: 0, // en vivo: se pide fresco en cada refresco del dataset

  async fetchAll(): Promise<NormalizedRecord[]> {
    const chargers = await loadCommunityChargers("approved");
    return chargers.map((c) => ({
      source: "community",
      externalId: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      address: c.address ? { full: c.address } : undefined,
      operator: c.operator,
      openingHours: c.openingHours,
      pricing: c.pricePerKwh ? { perKwh: c.pricePerKwh } : undefined,
      services: [],
      availability: { value: c.availability ?? "unknown", at: c.updatedAt },
      connectors: toConnectors(c.sockets),
      attributes: { notes: c.notes ?? "" },
      sourceUpdatedAt: c.updatedAt,
    }));
  },
};
