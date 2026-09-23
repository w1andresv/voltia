import type {
  Charger,
  ChargerSocket,
  ConnectorType,
  StationAvailability,
} from "@/lib/domain/types";
import { uniqueByProximity } from "@/lib/domain/geo";
import { isPlugshareToken, plugshareAuthHeader, plugshareLocationUrl } from "@/lib/plugshare";
import { fetchJson } from "./http";

const API = "https://api.plugshare.com/v3";

/**
 * PlugShare Station API (commercial license).
 * We never embed the web app's Basic/Cognito credentials — only a user/env key.
 */
function envServerToken(): string {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const env = g.process?.env ?? {};
  return (env.PLUGSHARE_TOKEN ?? env.VITE_PLUGSHARE_TOKEN ?? "").trim();
}

function resolveToken(client?: string): string {
  const fromClient = (client ?? "").trim();
  if (isPlugshareToken(fromClient)) return fromClient;
  const fromEnv = envServerToken();
  return isPlugshareToken(fromEnv) ? fromEnv : "";
}

const CONNECTOR_BY_CODE: Record<number, ConnectorType | null> = {
  1: null, // J1772
  2: "nacs",
  3: "chademo",
  4: null, // Tesla Roadster
  5: "ccs1",
  6: null, // NEMA
  7: "ccs2",
  8: "type2",
  9: "gb_t",
  10: "gb_t",
  11: null, // wall
};

const CONNECTOR_BY_NAME: Array<[RegExp, ConnectorType]> = [
  [/ccs\s*combo\s*2|ccs2|combo\s*2|type2_combo/i, "ccs2"],
  [/ccs\s*combo\s*1|ccs1|combo\s*1|type1_combo/i, "ccs1"],
  [/type\s*2|mennekes|iec\s*62196/i, "type2"],
  [/chademo/i, "chademo"],
  [/nacs|tesla\s*(supercharger|mag|nacs)|sae\s*j3400/i, "nacs"],
  [/gb\s*\/?\s*t|gbt/i, "gb_t"],
];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s || undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function locationsFromPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const obj = asRecord(raw);
  if (!obj) return [];
  for (const key of ["locations", "results", "data", "stations"]) {
    const list = asArray(obj[key]);
    if (list.length) return list;
  }
  return [];
}

function mapConnector(raw: unknown): ConnectorType | null {
  const n = asNumber(raw);
  if (n != null && n in CONNECTOR_BY_CODE) return CONNECTOR_BY_CODE[n] ?? null;
  const s = asString(raw);
  if (!s) return null;
  for (const [re, type] of CONNECTOR_BY_NAME) {
    if (re.test(s)) return type;
  }
  const asInt = Number(s);
  if (Number.isInteger(asInt) && asInt in CONNECTOR_BY_CODE) return CONNECTOR_BY_CODE[asInt] ?? null;
  return null;
}

function defaultKw(connector: ConnectorType): number {
  if (connector === "type2") return 22;
  if (connector === "nacs") return 150;
  return 50;
}

function readKw(outlet: Record<string, unknown>, connector: ConnectorType): number {
  const n =
    asNumber(outlet.kilowatts) ??
    asNumber(outlet.kw) ??
    asNumber(outlet.power_kw) ??
    asNumber(outlet.kilo_watts) ??
    asNumber(outlet.power);
  if (n && n > 0.5) return n > 1000 ? n / 1000 : n;
  return defaultKw(connector);
}

function readCount(outlet: Record<string, unknown>): number {
  const n = asNumber(outlet.quantity) ?? asNumber(outlet.count) ?? asNumber(outlet.outlets) ?? 1;
  return Math.min(40, Math.max(1, Math.round(n || 1)));
}

function collectOutlets(loc: Record<string, unknown>): Record<string, unknown>[] {
  const direct = asArray(loc.outlets).map(asRecord).filter(Boolean) as Record<string, unknown>[];
  const nested: Record<string, unknown>[] = [];
  for (const st of asArray(loc.stations)) {
    const rec = asRecord(st);
    if (!rec) continue;
    const outs = asArray(rec.outlets);
    if (outs.length) {
      for (const o of outs) {
        const row = asRecord(o);
        if (row) nested.push({ ...row, network_name: row.network_name ?? rec.network_name ?? rec.name });
      }
    } else {
      nested.push(rec);
    }
  }
  return nested.length ? nested : direct;
}

function socketsFromLocation(loc: Record<string, unknown>): ChargerSocket[] {
  const grouped = new Map<string, ChargerSocket>();
  for (const outlet of collectOutlets(loc)) {
    const connector = mapConnector(outlet.connector ?? outlet.connector_type ?? outlet.plug ?? outlet.type);
    if (!connector) continue;
    const powerKw = readKw(outlet, connector);
    const count = readCount(outlet);
    const key = `${connector}:${powerKw}`;
    const prev = grouped.get(key);
    if (prev) prev.count += count;
    else grouped.set(key, { connector, powerKw, count });
  }
  return [...grouped.values()];
}

function mapAccess(raw: unknown): string | undefined {
  const n = asNumber(raw);
  if (n === 1) return "public";
  if (n === 2) return "restricted";
  if (n === 3) return "private";
  const s = asString(raw)?.toLowerCase();
  if (!s) return undefined;
  if (s.includes("private") || s.includes("home") || s.includes("residential")) return "private";
  if (s.includes("restrict") || s.includes("customer") || s.includes("employee")) return "restricted";
  if (s.includes("public")) return "public";
  return s;
}

function mapAvailability(loc: Record<string, unknown>, outlets: Record<string, unknown>[]): {
  available: boolean | null;
  availability: StationAvailability;
} {
  const stalls = asNumber(loc.available_stalls);
  const total = asNumber(loc.total_stalls);
  if (stalls != null && stalls > 0) return { available: true, availability: "available" };
  const statuses = outlets
    .map((o) => asString(o.status)?.toLowerCase())
    .filter((s): s is string => Boolean(s));
  if (statuses.some((s) => s.includes("avail") || s === "free" || s === "idle")) {
    return { available: true, availability: "available" };
  }
  if (statuses.length && statuses.every((s) => /offline|out.?of.?order|fault|broken|closed/.test(s))) {
    return { available: false, availability: "offline" };
  }
  if (statuses.some((s) => /occup|in.?use|charging|busy/.test(s))) {
    return { available: false, availability: "occupied" };
  }
  if (total != null && stalls === 0) return { available: false, availability: "occupied" };
  return { available: null, availability: "unknown" };
}

function skipLocation(loc: Record<string, unknown>): boolean {
  if (loc.coming_soon === true) return true;
  const status = asString(loc.status)?.toLowerCase() ?? "";
  if (status.includes("coming") || status.includes("closed") || status.includes("removed")) return true;
  const code = asNumber(loc.status);
  if (code === 2 || code === 3) return true;
  return false;
}

export function mapPlugshareLocation(raw: unknown): Charger | null {
  const loc = asRecord(raw);
  if (!loc) return null;
  if (skipLocation(loc)) return null;
  const lat = asNumber(loc.latitude) ?? asNumber(loc.lat);
  const lon = asNumber(loc.longitude) ?? asNumber(loc.lng) ?? asNumber(loc.lon);
  if (lat == null || lon == null) return null;
  const sockets = socketsFromLocation(loc);
  if (!sockets.length) return null;
  const id = asString(loc.id) ?? asString(loc.location_id);
  if (!id) return null;
  const outlets = collectOutlets(loc);
  const { available, availability } = mapAvailability(loc, outlets);
  const network =
    asString(loc.network) ||
    asString(asRecord(loc.network)?.name) ||
    asString(outlets[0]?.network_name) ||
    asString(loc.owner);
  const address =
    asString(loc.address) ||
    [asString(loc.street), asString(loc.city), asString(loc.state)].filter(Boolean).join(", ") ||
    undefined;
  const score = asNumber(loc.score) ?? asNumber(loc.plugscore) ?? asNumber(loc.plug_score);
  const notes = [
    score != null ? `PlugScore ${score.toFixed(1)}` : "",
    asString(loc.description) ?? asString(loc.cost_description) ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  const access = mapAccess(loc.access ?? loc.access_type ?? loc.accessType);
  const updatedAt =
    asString(loc.last_confirmed) ??
    asString(loc.last_confirmed_at) ??
    asString(loc.updated_at) ??
    asString(loc.date_last_confirmed) ??
    asString(loc.modified_date);
  return {
    id: `ps-${id}`,
    name: asString(loc.name) || network || "Estación PlugShare",
    lat,
    lon,
    operator: network,
    sockets,
    access,
    openingHours: asString(loc.hours) ?? asString(loc.hours_description) ?? asString(loc.open_hours),
    source: "plugshare",
    available,
    availability,
    address,
    notes: notes || undefined,
    url: plugshareLocationUrl(id),
    verified: true,
    updatedAt,
  };
}

function warnFromError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 401|HTTP 403/.test(msg)) {
    return "PlugShare rechazó la clave. Revísala en el menú → PlugShare. Seguimos con OSM, catálogo verificado y comunidad confirmada.";
  }
  return "No se pudo consultar PlugShare. Seguimos con OSM, catálogo verificado y comunidad confirmada.";
}

async function requestLocations(token: string, path: string, cacheKey: string): Promise<Charger[]> {
  const raw = await fetchJson<unknown>(`${API}${path}`, {
    timeoutMs: 8000,
    cacheTtlMs: 10 * 60_000,
    cacheKey,
    headers: {
      authorization: plugshareAuthHeader(token),
      accept: "application/json",
      "user-agent": "Voltia/1.0 (EV trip planner)",
    },
  });
  const list: Charger[] = [];
  const seen = new Set<string>();
  for (const row of locationsFromPayload(raw)) {
    const c = mapPlugshareLocation(row);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    list.push(c);
  }
  return uniqueByProximity(list, 0.1);
}

export async function queryPlugshareRegion(input: {
  latitude: number;
  longitude: number;
  spanLat: number;
  spanLng: number;
  token?: string;
  count?: number;
}): Promise<{ chargers: Charger[]; warning?: string }> {
  const token = resolveToken(input.token);
  if (!token) return { chargers: [] };
  const count = Math.min(500, Math.max(20, input.count ?? 200));
  const lat = input.latitude;
  const lon = input.longitude;
  const spanLat = Math.min(4, Math.max(0.03, input.spanLat));
  const spanLng = Math.min(4, Math.max(0.03, input.spanLng));
  try {
    const wide = spanLat > 2.8 || spanLng > 2.8;
    const path = wide
      ? `/locations/nearby?latitude=${lat}&longitude=${lon}&count=${Math.min(count, 80)}&access=1,2`
      : `/locations/region?latitude=${lat}&longitude=${lon}&spanLat=${spanLat}&spanLng=${spanLng}&count=${count}&access=1,2`;
    const chargers = await requestLocations(token, path, `ps:${wide ? "n" : "r"}:${lat.toFixed(3)}:${lon.toFixed(3)}:${spanLat.toFixed(2)}`);
    return { chargers };
  } catch (err) {
    return { chargers: [], warning: warnFromError(err) };
  }
}

export async function findPlugshareAlong(
  samples: { lat: number; lon: number }[],
  token?: string,
): Promise<{ chargers: Charger[]; warning?: string }> {
  const key = resolveToken(token);
  if (!key || !samples.length) return { chargers: [] };

  const step = Math.max(1, Math.floor(samples.length / 6));
  const probes = samples.filter((_, i) => i % step === 0).slice(0, 6);

  const first = probes[0]!;
  const head = await queryPlugshareRegion({
    latitude: first.lat,
    longitude: first.lon,
    spanLat: 0.22,
    spanLng: 0.22,
    token: key,
    count: 120,
  });
  if (head.warning) return head;

  const rest = await Promise.all(
    probes.slice(1).map((p) =>
      queryPlugshareRegion({
        latitude: p.lat,
        longitude: p.lon,
        spanLat: 0.22,
        spanLng: 0.22,
        token: key,
        count: 120,
      }),
    ),
  );

  const chargers = [...head.chargers];
  for (const r of rest) chargers.push(...r.chargers);
  return { chargers: uniqueByProximity(chargers, 0.12) };
}
