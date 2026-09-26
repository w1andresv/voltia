import type { NormalizedRecord, SourceId } from "@/domain/stations/model";

export interface StationSource {
  id: SourceId;
  label: string;
  enabled(): boolean;
  timeoutMs: number;
  ttlMs: number;
  fetchAll(signal: AbortSignal): Promise<NormalizedRecord[]>;
}
