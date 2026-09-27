import "server-only";
import { createHash } from "node:crypto";
import type { StationCatalog } from "@/domain/ports/station-catalog";
import type { StationDetails } from "@/domain/ports/station-details";
import type { ConsolidatedStation, StationDataset } from "@/domain/stations/model";
import type { BlazeClient } from "./client";
import { logBlazeDetail, logBlazeList } from "./log";
import { blazeExternalId, toConsolidatedStation } from "./mappers";

/**
 * Listado de electrolineras desde Blaze (ADR-0008, D9), en la forma del
 * dataset consolidado: el planificador y el mapa no cambian. Si Blaze falla
 * se sirve el último listado bueno del proceso, marcado como viejo.
 */
export class BlazeStationCatalog implements StationCatalog {
  private last: StationDataset | null = null;

  constructor(
    private readonly client: BlazeClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getDataset(): Promise<StationDataset> {
    const started = Date.now();
    const fetchedAt = this.clock().toISOString();
    try {
      const raw = await this.client.listStations();
      logBlazeList(raw, Date.now() - started);
      const stations: ConsolidatedStation[] = [];
      let noCoords = 0;
      for (const s of raw) {
        const station = toConsolidatedStation(s, fetchedAt);
        if (station) stations.push(station);
        else noCoords++;
      }
      const eligible = stations.filter((s) => s.planning.eligible).length;
      this.last = {
        version: versionOf(stations),
        generatedAt: fetchedAt,
        stations,
        sources: [
          {
            id: "blaze",
            ok: true,
            stale: false,
            fetchedAt,
            records: raw.length,
            accepted: stations.length,
            rejected: noCoords ? { "sin coordenadas": noCoords } : {},
            durationMs: Date.now() - started,
          },
        ],
        stats: {
          raw: raw.length,
          valid: stations.length,
          stations: stations.length,
          merged: 0,
          eligible,
        },
      };
      if (noCoords)
        console.warn(
          `[blaze] ${noCoords} estación(es) sin coordenadas: la key necesita el scope location:read`,
        );
      return this.last;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[blaze] no se pudo leer el listado:", message);
      if (!this.last)
        throw new Error(`Blaze no respondió el listado de electrolineras: ${message}`);
      return {
        ...this.last,
        sources: this.last.sources.map((s) => ({ ...s, ok: false, stale: true, error: message })),
      };
    }
  }
}

/** Detalle de una estación de Blaze; null para ids que no son de Blaze. */
export class BlazeStationDetails implements StationDetails {
  constructor(
    private readonly client: BlazeClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async get(id: string): Promise<ConsolidatedStation | null> {
    const externalId = blazeExternalId(id);
    if (!externalId) return null;
    const started = Date.now();
    const raw = await this.client.station(externalId);
    logBlazeDetail(externalId, raw, Date.now() - started);
    return raw ? toConsolidatedStation(raw, this.clock().toISOString()) : null;
  }
}

/** Hash del contenido para el ETag de /api/stations: cambia solo si cambian las estaciones. */
function versionOf(stations: ConsolidatedStation[]): string {
  const content = JSON.stringify(
    stations.map(({ availability, sources, ...rest }) => ({
      ...rest,
      availability: availability.value,
      sources: sources.map((s) => s.externalId),
    })),
  );
  return `blaze-${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}
