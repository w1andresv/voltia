import type { Charger, ChargerSocket, ConnectorType } from "@/lib/domain/types";
import { isVerifiedForPlanning } from "@/lib/domain/types";
import { uniqueByProximity } from "@/lib/domain/geo";
import { fetchJson } from "./http";
import { CATALOG_CHARGERS } from "./chargers.catalog";

interface OverpassNode {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassNode[];
}

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

async function queryOverpass(samples: { lat: number; lon: number }[]): Promise<Charger[]> {
  if (!samples.length) return [];
  const step = Math.max(1, Math.floor(samples.length / 8));
  const probes = samples.filter((_, i) => i % step === 0);
  const parts = probes
    .map((p) => `node["amenity"="charging_station"](around:12000,${p.lat},${p.lon});`)
    .join("\n");
  const body = `[out:json][timeout:8];(\n${parts}\n);out center tags;`;
  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const data = await fetchJson<OverpassResponse>(url, {
        method: "POST",
        timeoutMs: 7000,
        cacheTtlMs: 10 * 60_000,
        cacheKey: `ov:${probes[0]?.lat.toFixed(2)}:${probes[0]?.lon.toFixed(2)}:${probes.length}`,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Voltia/1.0 (EV trip planner)",
        },
        body: `data=${encodeURIComponent(body)}`,
      });
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

export async function findChargersAlong(
  samples: { lat: number; lon: number }[],
  community: Charger[] = [],
  plugshareToken?: string,
): Promise<{
  chargers: Charger[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  let osm: Charger[] = [];
  try {
    osm = await queryOverpass(samples);
  } catch {
    warnings.push(
      "No se pudo consultar OpenStreetMap. Solo se usarán electrolineras verificadas de PlugShare, comunidad confirmada y catálogo del operador.",
    );
  }

  const { findPlugshareAlong } = await import("./chargers.plugshare");
  const plugshare = await findPlugshareAlong(samples, plugshareToken);
  if (plugshare.warning) warnings.push(plugshare.warning);

  const catalogNear = CATALOG_CHARGERS.filter(
    (c) => isVerifiedForPlanning(c) && samples.some((s) => Math.abs(s.lat - c.lat) + Math.abs(s.lon - c.lon) < 1.6),
  );

  const merged = uniqueByProximity(
    [
      ...community.filter(isVerifiedForPlanning),
      ...plugshare.chargers.filter(isVerifiedForPlanning),
      ...osm,
      ...catalogNear,
    ],
    0.18,
  );
  return { chargers: merged, warnings };
}
