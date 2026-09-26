import { z } from "zod";
import type { LatLon } from "@/domain/types";
import { fetchJson } from "./http";

const OSRM_ENDPOINTS = [
  "https://router.project-osrm.org",
  "https://routing.openstreetmap.de/routed-car",
];

/**
 * Se valida la respuesta de OSRM con Zod (no solo se le hace `as OsrmResponse`)
 * para que un cambio de forma en su API se note como un error claro acá, en
 * vez de romper el planificador en silencio con `undefined`s más adelante.
 */
export const OsrmRouteSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }),
  legs: z
    .array(
      z
        .object({
          summary: z.string().optional(),
          distance: z.number().optional(),
          // Con annotations=distance,duration: metros y segundos entre cada par de
          // puntos de la geometría. De ahí sale la velocidad de cada tramo.
          annotation: z
            .object({
              distance: z.array(z.number()).optional(),
              duration: z.array(z.number()).optional(),
            })
            .passthrough()
            .optional(),
          // Solo con steps=true (Mapbox): cada paso con su geometría y sus intersecciones,
          // que traen la clase vial del proveedor (mapbox_streets_v8.class).
          steps: z
            .array(
              z
                .object({
                  distance: z.number(),
                  duration: z.number(),
                  geometry: z
                    .object({ coordinates: z.array(z.tuple([z.number(), z.number()])) })
                    .optional(),
                  intersections: z
                    .array(
                      z
                        .object({
                          location: z.tuple([z.number(), z.number()]),
                          mapbox_streets_v8: z
                            .object({ class: z.string().optional() })
                            .passthrough()
                            .optional(),
                        })
                        .passthrough(),
                    )
                    .optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z.array(OsrmRouteSchema).optional(),
  /** Punto de la vía donde el motor "pegó" cada coordenada; `distance` = metros hasta ella. */
  waypoints: z
    .array(z.object({ distance: z.number().optional(), name: z.string().optional() }).passthrough())
    .optional(),
});

export type OsrmRoute = z.infer<typeof OsrmRouteSchema>;
type OsrmResponse = z.infer<typeof OsrmResponseSchema>;

/** Servidores públicos de OSRM: sin llave, pero con datos y tiempos menos precisos que Mapbox. */
export async function fetchOsrmCandidates(waypoints: LatLon[]): Promise<OsrmRoute[]> {
  if (waypoints.length < 2) throw new Error("Se necesitan origen y destino.");
  const path = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
  // alternatives=3: hasta 3 alternativas además de la principal (solo con 2 puntos).
  const qs = `overview=full&geometries=geojson&alternatives=${waypoints.length === 2 ? 3 : "false"}&steps=false&annotations=distance,duration`;
  // Si algún endpoint SÍ respondió pero sin ruta (código != "Ok"), ese es el
  // mensaje más útil para el usuario; un timeout/red caída da un mensaje
  // técnico en inglés que nunca debe llegarle así, así que solo se usa
  // cuando ningún endpoint llegó a responder.
  let noRouteFound = false;
  for (const base of OSRM_ENDPOINTS) {
    const url = `${base}/route/v1/driving/${path}?${qs}`;
    try {
      const raw = await fetchJson<unknown>(url, {
        timeoutMs: 18000,
        cacheTtlMs: 90_000,
        headers: { "user-agent": "Voltia/1.0 (EV trip planner)" },
      });
      const data: OsrmResponse = OsrmResponseSchema.parse(raw);
      if (data.code !== "Ok" || !data.routes?.length) {
        noRouteFound = true;
        continue;
      }
      return data.routes;
    } catch {
      // red o timeout — se intenta el siguiente endpoint
    }
  }
  throw new Error(
    noRouteFound
      ? "El motor de rutas no encontró un camino entre esos puntos."
      : "No se pudo calcular la ruta. Intenta de nuevo en unos segundos.",
  );
}
