import type { Place } from "@/domain/types";
import { fetchJson } from "./http";

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
    osm_value?: string;
  };
}

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

function dedupe(places: Place[]): Place[] {
  const out: Place[] = [];
  for (const p of places) {
    if (out.some((x) => Math.abs(x.lat - p.lat) < 0.015 && Math.abs(x.lon - p.lon) < 0.015)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Photon solo traduce a los idiomas cargados en la instancia pública (default, en, de, fr);
 * según la versión, `lang=es` devuelve HTTP 400. Se intenta "es" y, si falla con 4xx,
 * se repite con "default" (nombre local de OSM: en Colombia ya viene en español).
 */
async function searchPhoton(q: string, bias?: { lat: number; lon: number }): Promise<Place[]> {
  try {
    return await searchPhotonLang(q, "es", bias);
  } catch (error) {
    if (!(error instanceof Error) || !/HTTP 4\d\d/.test(error.message)) throw error;
    return searchPhotonLang(q, "default", bias);
  }
}

async function searchPhotonLang(q: string, lang: string, bias?: { lat: number; lon: number }): Promise<Place[]> {
  const params = new URLSearchParams({ q, lang, limit: "6" });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
  }
  const url = `https://photon.komoot.io/api/?${params.toString()}`;
  const data = await fetchJson<PhotonResponse>(url, {
    timeoutMs: 5000,
    cacheTtlMs: 120_000,
    headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
  });
  const places: Place[] = [];
  for (const f of data.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    const { label, context } = labelOf(f.properties);
    const full = context ? `${label}, ${context}` : label;
    places.push({ label: full, lat, lon, context });
  }
  return places;
}

async function searchOpenMeteo(q: string): Promise<Place[]> {
  const params = new URLSearchParams({ name: q, count: "6", language: "es" });
  const data = await fetchJson<OpenMeteoGeo>(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    timeoutMs: 8000,
    cacheTtlMs: 120_000,
  });
  return (data.results ?? []).map((r) => {
    const label = r.admin1 ? `${r.name}, ${r.admin1}` : r.name;
    const context = r.country;
    return { label, lat: r.latitude, lon: r.longitude, context };
  });
}

export async function searchPlaces(query: string, bias?: { lat: number; lon: number }): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  let places: Place[] = [];
  let photonError: unknown = null;
  try {
    places = await searchPhoton(q, bias);
  } catch (error) {
    photonError = error;
    console.warn("[geocode] photon falló:", errorText(error));
  }
  if (places.length < 4) {
    try {
      places = dedupe([...places, ...(await searchOpenMeteo(q))]);
    } catch (error) {
      console.warn("[geocode] open-meteo falló:", errorText(error));
      // Ambos proveedores caídos: se propaga el error para que la UI diga
      // "no se pudo buscar" en vez de un engañoso "Sin resultados".
      if (photonError) throw new Error("No se pudo consultar ningún proveedor de búsqueda de lugares.");
    }
  }
  return places.slice(0, 8);
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
