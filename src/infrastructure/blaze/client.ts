import "server-only";
import { fetchJson } from "@/infrastructure/providers/http";
import { BlazeStationListSchema, BlazeStationSchema, type BlazeStation } from "./schemas";

/**
 * Cliente de la API pública de Blaze (docs/blaze/api-publica-v1.md). La key va
 * en la cabecera X-API-Key, nunca en la URL: así no llega a los logs ni a la
 * clave de la caché.
 */
export interface BlazeClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Listado: cambia poco; se comparte entre usuarios en la Data Cache de Next. */
  listTtlMs?: number;
  /** Detalle: trae el estado de cada cargador, así que dura poco. */
  detailTtlMs?: number;
  listTimeoutMs?: number;
  detailTimeoutMs?: number;
}

export const BLAZE_LIST_TTL_MS = 15 * 60 * 1000;
export const BLAZE_DETAIL_TTL_MS = 2 * 60 * 1000;

export class BlazeClient {
  private readonly baseUrl: string;

  constructor(private readonly options: BlazeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  private get headers() {
    return { "x-api-key": this.options.apiKey };
  }

  async listStations(): Promise<BlazeStation[]> {
    const url = `${this.baseUrl}/stations`;
    const raw = await fetchJson<unknown>(url, {
      headers: this.headers,
      timeoutMs: this.options.listTimeoutMs ?? 15_000,
      cacheTtlMs: this.options.listTtlMs ?? BLAZE_LIST_TTL_MS,
      cacheKey: `blaze:list:${url}`,
    });
    return BlazeStationListSchema.parse(raw);
  }

  /** null si Blaze responde 404 (la estación ya no está activa). */
  async station(externalId: string): Promise<BlazeStation | null> {
    const url = `${this.baseUrl}/stations/${encodeURIComponent(externalId)}`;
    try {
      const raw = await fetchJson<unknown>(url, {
        headers: this.headers,
        timeoutMs: this.options.detailTimeoutMs ?? 4_000,
        cacheTtlMs: this.options.detailTtlMs ?? BLAZE_DETAIL_TTL_MS,
        cacheKey: `blaze:detail:${url}`,
      });
      return BlazeStationSchema.parse(raw);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("HTTP 404")) return null;
      throw error;
    }
  }
}
