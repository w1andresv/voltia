import { z } from "zod";
import type { Charger, ChargerSocket, ConnectorType } from "@/domain/types";
import { fetchJson } from "./http";
import type { ChargerProvider } from "./chargers/types";

const ENDPOINT = "https://siveeic.minenergia.gov.co:3011/crg/resumenestacionescarga/0/0";

/** Solo los campos que consumimos — el resto de la respuesta (archivos, horario, geometría WKB) no nos sirve. */
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
});

const SiveeicResponseSchema = z.array(SiveeicStationSchema);

type SiveeicStation = z.infer<typeof SiveeicStationSchema>;

/**
 * SIVEEIC no expone potencia por conector, solo el nombre del estándar y
 * cuántos hay: la potencia es un valor por defecto razonable por tipo, igual
 * que el fallback que ya usan OSM/PlugShare cuando falta el dato.
 * "Tipo 1 - SAE J1772" y "Schuko" se ignoran: no son ConnectorType soportados.
 */
const CONNECTOR_MAP: Record<string, ConnectorType> = {
  "CCS Combo 1": "ccs1",
  "CCS Combo 2": "ccs2",
  CHAdeMO: "chademo",
  "Tipo 2 - IEC 62196": "type2",
  "GB-T AC": "gb_t",
  "GB-T DC": "gb_t",
};

const DEFAULT_KW: Record<ConnectorType, number> = {
  ccs1: 50,
  ccs2: 50,
  chademo: 50,
  type2: 22,
  gb_t: 60,
  nacs: 150,
};

function socketsFromConectores(conectores: SiveeicStation["Conectores"]): ChargerSocket[] {
  if (!conectores) return [];
  const sockets: ChargerSocket[] = [];
  for (const [label, count] of Object.entries(conectores)) {
    const connector = CONNECTOR_MAP[label];
    if (!connector || !(count > 0)) continue;
    sockets.push({ connector, powerKw: DEFAULT_KW[connector], count });
  }
  return sockets;
}

export function stationToCharger(s: SiveeicStation): Charger | null {
  const lat = Number(s.Latitud);
  const lon = Number(s.Longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const estado = s.Estado?.NombreEstado?.trim().toLowerCase();
  if (estado && estado !== "activo") return null;
  const sockets = socketsFromConectores(s.Conectores);
  if (!sockets.length) return null;
  const address = [s.Direccion, s.Municipio?.NombreMunicipio].filter(Boolean).join(", ") || undefined;
  return {
    id: `siveeic-${s.Id}`,
    name: s.Nombre?.trim() || s.Operador?.Nombreempresa || "Estación de carga",
    lat,
    lon,
    operator: s.Operador?.Nombreempresa,
    sockets,
    source: "siveeic",
    available: null,
    availability: "unknown",
    verified: true,
    address,
  };
}

/** Token del registro nacional de electrolineras (SIVEEIC/MinEnergía). Solo servidor. */
function envToken(): string {
  return (process.env.SIVEEIC_TOKEN ?? "").trim();
}

/** Lista nacional completa, cacheada 6h: es pequeña (~200 estaciones) y casi no cambia. */
async function fetchStations(): Promise<Charger[]> {
  const token = envToken();
  if (!token) return [];
  const raw = await fetchJson<unknown>(ENDPOINT, {
    timeoutMs: 10000,
    cacheTtlMs: 6 * 60 * 60_000,
    cacheKey: "siveeic:all",
    headers: { authorization: `Bearer ${token}` },
  });
  const parsed = SiveeicResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const list: Charger[] = [];
  for (const row of parsed.data) {
    const c = stationToCharger(row);
    if (c) list.push(c);
  }
  return list;
}

export const siveeicProvider: ChargerProvider = {
  id: "siveeic",
  name: "SIVEEIC (MinEnergía)",
  async findAlong(samples) {
    try {
      const all = await fetchStations();
      const chargers = all.filter((c) =>
        samples.some((s) => Math.abs(s.lat - c.lat) + Math.abs(s.lon - c.lon) < 1.6),
      );
      return { chargers, warnings: [] };
    } catch {
      return {
        chargers: [],
        warnings: ["No se pudo consultar el registro nacional de electrolineras (SIVEEIC)."],
      };
    }
  },
};
