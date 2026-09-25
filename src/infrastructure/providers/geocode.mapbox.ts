import { z } from "zod";
import type { Place } from "@/domain/types";
import { fetchJson } from "./http";

/**
 * Búsqueda de lugares con Mapbox Geocoding v6. Es el mismo geocodificador que
 * usa Mapbox al trazar rutas, así que el punto de un pueblo es su centro urbano
 * (no el centro geográfico del municipio, que en Santander puede quedar a 10 km
 * y sumar 20–40 km de camino rural). Limitado a Colombia, que es donde está la
 * red de carga de la app.
 */
const FeatureSchema = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z
    .object({
      name: z.string().optional(),
      name_preferred: z.string().optional(),
      full_address: z.string().optional(),
      place_formatted: z.string().optional(),
      feature_type: z.string().optional(),
      coordinates: z
        .object({
          longitude: z.number(),
          latitude: z.number(),
          routable_points: z
            .array(z.object({ longitude: z.number(), latitude: z.number() }).passthrough())
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

const ResponseSchema = z.object({ features: z.array(FeatureSchema).default([]) });

export async function searchMapbox(
  q: string,
  token: string,
  bias?: { lat: number; lon: number },
): Promise<Place[]> {
  const params = new URLSearchParams({
    q,
    country: "co",
    language: "es",
    limit: "6",
    autocomplete: "true",
    types: "place,locality,neighborhood,street,address",
  });
  if (bias) params.set("proximity", `${bias.lon},${bias.lat}`);
  const cacheKey = `mapbox-geocode:${params.toString()}`;
  params.set("access_token", token);
  const raw = await fetchJson<unknown>(
    `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
    {
      timeoutMs: 5000,
      cacheTtlMs: 300_000,
      cacheKey,
    },
  );
  const data = ResponseSchema.parse(raw);
  return data.features.map((f) => {
    const p = f.properties;
    // Para direcciones, el punto de acceso por la vía es mejor destino que el techo del edificio.
    const routable = p.coordinates?.routable_points?.[0];
    const [lon, lat] = routable ? [routable.longitude, routable.latitude] : f.geometry.coordinates;
    const name = p.name_preferred || p.name || p.full_address || "Lugar";
    const context = p.place_formatted || undefined;
    return { label: context ? `${name}, ${context}` : name, lat, lon, context };
  });
}
