import { z } from "zod";
import type { Charger, ChargerSocket, ConnectorType } from "@/domain/types";
import { isVerifiedForPlanning } from "@/domain/types";
import { haversineKm, uniqueByProximity } from "@/domain/geo";
import { fetchJson } from "./http";
import type { ChargerProvider } from "./chargers/types";

/**
 * Igual que con OSRM: se valida con Zod para que un cambio de forma en la
 * respuesta de Overpass se note aquí, en vez de fallar en silencio más
 * adelante en nodeToCharger.
 */
const OverpassNodeSchema = z.object({
  type: z.enum(["node", "way"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const OverpassResponseSchema = z.object({
  elements: z.array(OverpassNodeSchema).optional(),
});

type OverpassNode = z.infer<typeof OverpassNodeSchema>;
type OverpassResponse = z.infer<typeof OverpassResponseSchema>;

function parseKw(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 1000) return n / 1000;
  return n;
}

function socketsFromTags(tags: Record<string, string>): ChargerSocket[] {
  const found: ChargerSocket[] = [];
  const add = (connector: ConnectorType, keys: string[], fallback: number) => {
    const has = keys.some((k) => tags[k] !== undefined || tags[`${k}:output`] !== undefined);
    if (!has) return;
    let kw = fallback;
    for (const k of keys) {
      const parsed = parseKw(tags[`${k}:output`] || tags[k]);
      if (parsed && parsed > 1) kw = Math.max(kw, parsed);
    }
    const count = Number(tags[keys[0]!] ?? 1) || 1;
    found.push({ connector, powerKw: kw, count: Number.isFinite(count) ? count : 1 });
  };

  add("ccs2", ["socket:type2_combo", "socket:ccs", "socket:type2_ccs"], 50);
  add("ccs1", ["socket:type1_combo"], 50);
  add("type2", ["socket:type2"], 22);
  add("chademo", ["socket:chademo"], 50);
  add("nacs", ["socket:nacs", "socket:tesla_supercharger", "socket:tesla"], 150);
  add("gb_t", ["socket:gb_t", "socket:type_gbt"], 60);

  if (!found.length) {
    const tesla = /tesla/i.test(tags.brand ?? "") || tags.tesla === "yes";
    if (tesla) {
      found.push({ connector: "nacs", powerKw: 150, count: 8 });
      found.push({ connector: "ccs2", powerKw: 150, count: 4 });
    } else {
      found.push({ connector: "type2", powerKw: 22, count: 1 });
    }
  }
  return found;
}

function nodeToCharger(n: OverpassNode): Charger | null {
  const lat = n.lat ?? n.center?.lat;
  const lon = n.lon ?? n.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = n.tags ?? {};
  const name =
    tags.name ||
    tags["name:es"] ||
    (tags.operator ? `${tags.operator}` : "Estación de carga");
  const address =
    tags["addr:full"] ||
    [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean).join(" ") ||
    undefined;
  return {
    id: `osm-${n.type}-${n.id}`,
    name,
    lat,
    lon,
    operator: tags.operator || tags.brand || tags.network,
    sockets: socketsFromTags(tags),
    access: tags.access,
    openingHours: tags.opening_hours,
    source: "osm",
    available: null,
    availability: "unknown",
    verified: true,
    updatedAt: new Date().toISOString().slice(0, 10),
    address,
  };
}

/** Radio de búsqueda de cada sonda (m); las sondas se separan ~1,5 radios. */
const PROBE_RADIUS_M = 12000;
const PROBE_SPACING_KM = 18;
const MAX_PROBES = 32;

/**
 * Puntos de consulta a lo largo de una o varias rutas: uno cada ~18 km y nunca
 * repetido donde las rutas se solapan (así varias alternativas no multiplican
 * la consulta). Si hay demasiados, se reparten uniformemente.
 */
export function pickProbes(samples: { lat: number; lon: number }[]): { lat: number; lon: number }[] {
  const probes: { lat: number; lon: number }[] = [];
  for (const s of samples) {
    if (probes.every((p) => haversineKm(p, s) >= PROBE_SPACING_KM)) probes.push(s);
  }
  const last = samples[samples.length - 1];
  if (last && probes.every((p) => haversineKm(p, last) >= PROBE_SPACING_KM / 2)) probes.push(last);
  if (probes.length <= MAX_PROBES) return probes;
  const step = probes.length / MAX_PROBES;
  return Array.from({ length: MAX_PROBES }, (_, i) => probes[Math.floor(i * step)]!);
}

async function queryOverpass(samples: { lat: number; lon: number }[]): Promise<Charger[]> {
  if (!samples.length) return [];
  const probes = pickProbes(samples);
  const parts = probes
    .map((p) => `node["amenity"="charging_station"](around:${PROBE_RADIUS_M},${p.lat},${p.lon});`)
    .join("\n");
  const body = `[out:json][timeout:8];(\n${parts}\n);out center tags;`;
  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const raw = await fetchJson<unknown>(url, {
        method: "POST",
        timeoutMs: 7000,
        cacheTtlMs: 10 * 60_000,
        // Todas las sondas en la clave: con solo la primera, dos rutas que salen del
        // mismo sitio compartían (por error) el resultado en caché.
        cacheKey: `ov:${probes.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(";")}`,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Voltia/1.0 (EV trip planner)",
        },
        body: `data=${encodeURIComponent(body)}`,
      });
      const data: OverpassResponse = OverpassResponseSchema.parse(raw);
      const list: Charger[] = [];
      for (const el of data.elements ?? []) {
        const c = nodeToCharger(el);
        if (c && isVerifiedForPlanning(c)) list.push(c);
      }
      return uniqueByProximity(list, 0.12);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass failed");
}

/** Solo OSM/Overpass, sin merge con las demás fuentes — eso lo hace chargers.cache.ts. */
export const overpassProvider: ChargerProvider = {
  id: "osm",
  name: "OpenStreetMap",
  async findAlong(samples) {
    try {
      return { chargers: await queryOverpass(samples), warnings: [] };
    } catch {
      return {
        chargers: [],
        warnings: [
          "No se pudo consultar OpenStreetMap. Solo se usarán electrolineras verificadas de PlugShare, comunidad confirmada y catálogo del operador.",
        ],
      };
    }
  },
};

