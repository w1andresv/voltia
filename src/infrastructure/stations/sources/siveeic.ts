import { z } from "zod";
import type { NormalizedRecord, StationConnector } from "@/domain/stations/model";
import { standardizeConnector, currentFromStandard } from "@/domain/stations/connectors";
import type { StationSource } from "./types";
import { fetchJson } from "@/infrastructure/providers/http";

const ENDPOINT = "https://siveeic.minenergia.gov.co:3011/crg/resumenestacionescarga/0/0";

const SiveeicStationSchema = z.object({
  Id: z.string(),
  Nombre: z.string().optional(),
  Direccion: z.string().optional(),
  Operador: z.object({ Nombreempresa: z.string().optional() }).optional(),
  Municipio: z.object({ NombreMunicipio: z.string().optional() }).optional(),
  Latitud: z.union([z.string(), z.number()]),
  Longitud: z.union([z.string(), z.number()]),
  Estado: z.object({ NombreEstado: z.string().optional() }).optional(),
  Conectores: z.record(z.string(), z.number()).optional(),
}).passthrough();

const SiveeicResponseSchema = z.array(SiveeicStationSchema);
type SiveeicStation = z.infer<typeof SiveeicStationSchema>;

function parseSockets(conectores: Record<string, number> | undefined): StationConnector[] {
  if (!conectores) return [];
  const sockets: StationConnector[] = [];
  
  for (const [label, count] of Object.entries(conectores)) {
    if (!(count > 0)) continue;
    const standard = standardizeConnector(label);
    const current = currentFromStandard(standard);
    
    sockets.push({
      standard,
      rawLabel: label,
      quantity: count,
      powerKw: null, // SIVEEIC no reporta potencia; merge.ts asume un valor por defecto por estándar
      current: current as any,
      currentOrigin: current ? "standard" : null,
      voltageV: null,
      amperageA: null,
      status: "unknown",
      confirmed: true,
      sources: ["siveeic"]
    });
  }
  return sockets;
}

function stationToRecord(s: SiveeicStation): NormalizedRecord | null {
  const lat = Number(s.Latitud);
  const lon = Number(s.Longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Si no está activo, lo registramos pero guardamos la razón (luego `validate` lo rechazará)
  const estado = s.Estado?.NombreEstado?.trim().toLowerCase();
  
  const addressStr = [s.Direccion, s.Municipio?.NombreMunicipio].filter(Boolean).join(", ");
  
  return {
    source: "siveeic",
    externalId: s.Id,
    name: s.Nombre?.trim() || "",
    lat,
    lon,
    address: {
      full: addressStr || undefined,
      street: s.Direccion,
      city: s.Municipio?.NombreMunicipio
    },
    operator: s.Operador?.Nombreempresa,
    availability: { value: "unknown" },
    services: [],
    connectors: parseSockets(s.Conectores),
    attributes: {
      Id: s.Id,
      Nombre: s.Nombre ?? "",
      Direccion: s.Direccion ?? "",
      OperadorNombreempresa: s.Operador?.Nombreempresa ?? "",
      MunicipioNombre: s.Municipio?.NombreMunicipio ?? "",
      Latitud: String(s.Latitud),
      Longitud: String(s.Longitud),
      Estado: estado ?? "",
      ConectoresJson: JSON.stringify(s.Conectores ?? {}),
    },
    url: undefined
  };
}

function envToken(): string {
  return (process.env.SIVEEIC_TOKEN ?? "").trim();
}

export const siveeicSource: StationSource = {
  id: "siveeic",
  label: "SIVEEIC (MinEnergía)",
  enabled: () => Boolean(envToken()),
  timeoutMs: 20_000,
  ttlMs: 6 * 60 * 60 * 1000, // 6 horas
  
  async fetchAll(signal: AbortSignal): Promise<NormalizedRecord[]> {
    const token = envToken();
    if (!token) throw new Error("Falta SIVEEIC_TOKEN");
    
    const raw = await fetchJson<unknown>(ENDPOINT, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal
    });
    
    const parsed = SiveeicResponseSchema.parse(raw);
    return parsed.map(stationToRecord).filter((r): r is NormalizedRecord => r !== null);
  }
};
