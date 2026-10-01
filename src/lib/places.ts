import type { Place } from "@/domain/types";

/** Clave de caché de una búsqueda: sin mayúsculas ni espacios de más. */
export function placeQueryKey(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Lugares para el texto `q` (GET /api/places). `signal` cancela la búsqueda si ya no sirve. */
export async function fetchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`/api/places?${new URLSearchParams({ q: q.trim() })}`, { signal });
  if (!res.ok) throw new Error(`No se pudo buscar lugares (HTTP ${res.status}).`);
  return (await res.json()) as Place[];
}
