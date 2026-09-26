import type { ConnectorType, StationAvailability } from "../types";

export type SourceId = "osm" | "siveeic" | "community" | "catalog" | "plugshare" | "ocm";

export type CurrentType = "AC" | "DC";

export type ExtendedConnectorType = ConnectorType | "type1" | "schuko" | "tesla_destination" | "other";

export interface StationConnector {
  standard: ExtendedConnectorType;
  rawLabel: string;
  quantity: number | null;
  powerKw: number | null;
  current: CurrentType | null;
  currentOrigin: "reported" | "standard" | null;
  voltageV: number | null;
  amperageA: number | null;
  status: StationAvailability;
  confirmed: boolean;
  sources: SourceId[];
}

export interface SourceRef {
  source: SourceId;
  externalId: string;
  url?: string;
  fetchedAt: string;
  sourceUpdatedAt?: string;
}

export interface NormalizedRecord {
  source: SourceId;
  externalId: string;
  name: string;
  lat: number;
  lon: number;
  address?: { full?: string; street?: string; city?: string; department?: string };
  operator?: string;
  network?: string;
  brand?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  email?: string;
  pricing?: { text?: string; perKwh?: { amount: number; currency: string }; free?: boolean };
  access?: "public" | "customers" | "restricted" | "private";
  services: string[];
  availability: { value: StationAvailability; at?: string };
  connectors: StationConnector[];
  attributes: Record<string, string | number | boolean>;
  sourceUpdatedAt?: string;
  url?: string;
}

export interface ConsolidatedStation {
  id: string; // "st_" + hash of highest priority SourceRef
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
  coordSource: SourceId;
  address?: { full?: string; street?: string; city?: string; department?: string };
  operator?: string;
  network?: string;
  brand?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  email?: string;
  pricing?: { text?: string; perKwh?: { amount: number; currency: string }; free?: boolean };
  access?: "public" | "customers" | "restricted" | "private";
  services: string[];
  availability: { value: StationAvailability; source?: SourceId; at?: string };
  connectors: StationConnector[];
  sources: SourceRef[];
  attributes: Partial<Record<SourceId, Record<string, string | number | boolean>>>;
  conflicts: { field: string; values: { source: SourceId; value: unknown }[] }[];
  planning: { eligible: boolean; reasons: string[] };
}

export interface DatasetSourceStatus {
  id: SourceId;
  ok: boolean;
  stale: boolean;
  fetchedAt?: string;
  records: number;
  accepted: number;
  rejected: Record<string, number>;
  error?: string;
  durationMs?: number;
}

export interface StationDataset {
  version: string;
  generatedAt: string;
  stations: ConsolidatedStation[];
  sources: DatasetSourceStatus[];
  stats: { raw: number; valid: number; stations: number; merged: number; eligible: number };
}
