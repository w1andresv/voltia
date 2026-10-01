import type { Place } from "@/domain/types";
import { fetchJson } from "./http";

/**
 * Photon (OSM): solo para el nombre del punto que se toca en el mapa. La
 * búsqueda de lugares es de Mapbox (`geocode.mapbox.ts`).
 */
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
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

function labelOf(p: PhotonFeature["properties"]): { label: string; context?: string } {
  const name = p.name || p.street || p.locality || p.city || "Lugar";
  const bits = [p.city || p.locality || p.county, p.state, p.country].filter(
    (x, i, arr) => x && arr.indexOf(x) === i && x !== name,
  );
  return { label: name, context: bits.join(", ") || undefined };
}

export async function reversePlace(lat: number, lon: number): Promise<Place> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: "es" });
  const url = `https://photon.komoot.io/reverse?${params.toString()}`;
  try {
    const data = await fetchJson<PhotonResponse>(url, {
      timeoutMs: 7000,
      cacheTtlMs: 300_000,
      headers: { "user-agent": "EV-on-way/1.0 (EV trip planner)" },
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
