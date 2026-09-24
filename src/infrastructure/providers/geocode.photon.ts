import { haversineKm } from "@/domain/geo";
import type { Place } from "@/domain/types";
import { fetchJson } from "./http";
import { searchMapbox } from "./geocode.mapbox";
import { mapboxServerToken } from "./routing.mapbox";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    city?: string;
    locality?: string;
    county?: string;
    state?: string;
    country?: string;
    district?: string;
    osm_key?: string;
    osm_value?: string;
    osm_type?: string;
    type?: string;
  };
}

/**
 * Qué tan buen punto de ruta es un resultado de Photon:
 *  0 = nodo de población (city/town/village…): el centro urbano, lo que el usuario quiere;
 *  1 = otros lugares y direcciones;
 *  2 = límite administrativo (municipio, provincia): su punto es el CENTRO GEOGRÁFICO
 *      del polígono, que puede caer en zona rural a 10+ km del pueblo y alargar la ruta.
 */
function photonRank(p: PhotonFeature["properties"]): number {
  if (
    p.osm_key === "place" &&
    ["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter"].includes(
      p.osm_value ?? "",
    )
  )
    return 0;
  if (p.osm_key === "boundary" || p.osm_type === "R") return 2;
  return 1;
}

/** Colombia: sesgo por defecto de Photon (sin él, "Vélez" devuelve primero España). */
const COLOMBIA_BIAS = { lat: 5.6, lon: -74.3 };

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface OpenMeteoGeo {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    admin1?: string;
    country?: string;
  }[];
}

function labelOf(p: PhotonFeature["properties"]): { label: string; context?: string } {
  const name = p.name || p.street || p.locality || p.city || "Lugar";
  const bits = [p.city || p.locality || p.county, p.state, p.country].filter(
    (x, i, arr) => x && arr.indexOf(x) === i && x !== name,
  );
  return { label: name, context: bits.join(", ") || undefined };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
}

/**
 * Photon solo traduce a los idiomas cargados en la instancia pública (default, en, de, fr);
 * según la versión, `lang=es` devuelve HTTP 400. Se intenta "es" y, si falla con 4xx,
 * se repite con "default" (nombre local de OSM: en Colombia ya viene en español).
 */
async function searchPhoton(q: string, bias?: { lat: number; lon: number }): Promise<Ranked[]> {
  try {
    return await searchPhotonLang(q, "es", bias);
  } catch (error) {
    if (!(error instanceof Error) || !/HTTP 4\d\d/.test(error.message)) throw error;
    return searchPhotonLang(q, "default", bias);
  }
}

async function searchPhotonLang(
  q: string,
  lang: string,
  bias?: { lat: number; lon: number },
): Promise<Ranked[]> {
  const params = new URLSearchParams({ q, lang, limit: "8" });
  const center = bias ?? COLOMBIA_BIAS;
  params.set("lat", String(center.lat));
  params.set("lon", String(center.lon));
  if (!bias) params.set("zoom", "6");
  const url = `https://photon.komoot.io/api/?${params.toString()}`;
  const data = await fetchJson<PhotonResponse>(url, {
    timeoutMs: 5000,
    cacheTtlMs: 120_000,
    headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
  });
  const ranked = (data.features ?? [])
    .map((f, i) => ({ f, i, rank: photonRank(f.properties) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.map(({ f, rank }) => {
    const [lon, lat] = f.geometry.coordinates;
    const { label, context } = labelOf(f.properties);
    const full = context ? `${label}, ${context}` : label;
    return { label: full, lat, lon, context, boundary: rank === 2, name: label };
  });
}

type Ranked = Place & { boundary?: boolean; name?: string };

function norm(s: string | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(",")[0]!
    .trim();
}

/**
 * Une resultados: quita repetidos (< 1,5 km) y descarta el centro geográfico de
 * un municipio cuando ya hay un lugar con el mismo nombre a menos de 40 km
 * (el pueblo): así "Vélez" lleva al casco urbano y no a una vereda.
 */
export function mergePlaces(groups: Ranked[][]): Place[] {
  const all = groups.flat();
  const out: Place[] = [];
  for (const p of all) {
    if (p.boundary) {
      const hasTown = all.some(
        (o) =>
          !o.boundary &&
          norm(o.name ?? o.label) === norm(p.name ?? p.label) &&
          haversineKm(o, p) < 40,
      );
      if (hasTown) continue;
    }
    if (out.some((x) => haversineKm(x, p) < 1.5)) continue;
    out.push({ label: p.label, lat: p.lat, lon: p.lon, context: p.context });
  }
  return out;
}

async function searchOpenMeteo(q: string): Promise<Ranked[]> {
  const params = new URLSearchParams({ name: q, count: "6", language: "es" });
  const data = await fetchJson<OpenMeteoGeo>(
    `https://geocoding-api.open-meteo.com/v1/search?${params}`,
    {
      timeoutMs: 8000,
      cacheTtlMs: 120_000,
    },
  );
  return (data.results ?? []).map((r) => {
    const label = r.admin1 ? `${r.name}, ${r.admin1}` : r.name;
    const context = r.country;
    return { label, lat: r.latitude, lon: r.longitude, context, name: r.name };
  });
}

/**
 * Búsqueda de lugares. Con token de Mapbox, su geocodificador va primero: es el
 * mismo que usa al trazar la ruta, así origen y destino coinciden con lo que
 * muestra Mapbox. Photon y Open-Meteo completan (y son el respaldo sin token).
 * Los tres se consultan en paralelo; solo falla si fallan todos.
 */
export async function searchPlaces(
  query: string,
  bias?: { lat: number; lon: number },
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const token = mapboxServerToken();
  const [mapbox, photon, openMeteo] = await Promise.allSettled([
    token ? searchMapbox(q, token, bias) : Promise.reject(new Error("sin token")),
    searchPhoton(q, bias),
    searchOpenMeteo(q),
  ]);
  const attempts = [
    ["mapbox", mapbox],
    ["photon", photon],
    ["open-meteo", openMeteo],
  ] as const;
  for (const [name, r] of attempts) {
    if (r.status === "rejected" && (name !== "mapbox" || token)) {
      console.warn(`[geocode] ${name} falló:`, errorText(r.reason));
    }
  }
  if (attempts.every(([, r]) => r.status === "rejected")) {
    // Todos caídos: se propaga el error para que la UI diga "no se pudo buscar"
    // en vez de un engañoso "Sin resultados".
    throw new Error("No se pudo consultar ningún proveedor de búsqueda de lugares.");
  }
  const ok = <T>(r: PromiseSettledResult<T[]>): T[] => (r.status === "fulfilled" ? r.value : []);
  const photonPlaces = ok(photon);
  return mergePlaces([
    ok(mapbox),
    photonPlaces.filter((p) => !p.boundary),
    ok(openMeteo),
    photonPlaces.filter((p) => p.boundary),
  ]).slice(0, 8);
}

export async function reversePlace(lat: number, lon: number): Promise<Place> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: "es" });
  const url = `https://photon.komoot.io/reverse?${params.toString()}`;
  try {
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 7000,
      cacheTtlMs: 300_000,
      headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
    });
    const f = data.features?.[0];
    if (f) {
      const { label, context } = labelOf(f.properties);
      return { label: context ? `${label}, ${context}` : label, lat, lon, context };
    }
  } catch {
    /* fall through */
  }
  return {
    label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    lat,
    lon,
  };
}
