import { z } from "zod";
import type { GeoBundle } from "../../types";

/**
 * Todo lo externo que usó un plan (plan §3.2): con el mismo snapshot, el mismo
 * vehículo y las mismas condiciones, `computePlans` da el mismo resultado. Se
 * guarda con el viaje para que abrirlo o compartirlo no vuelva a consultar a
 * los proveedores.
 *
 * Diferencia con la especificación: las rutas van ya muestreadas y con la
 * elevación aplicada (`RawRoute`), no crudas. Guardar la geometría completa y
 * la elevación cruda multiplica el tamaño y hoy no se usa; si el muestreo
 * cambia, se sube `SNAPSHOT_SCHEMA_VERSION` y los viajes viejos se recalculan
 * con datos nuevos.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface PlanningSnapshot extends GeoBundle {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** Cuándo se reunieron los datos (ISO 8601). */
  createdAt: string;
  /** Versión del modelo con que se calculó (ModelParameters.modelVersion). */
  modelVersion: string;
  plannerEngine: "legacy" | "v2";
  providers: { routing: string; elevation: string; weather: string | null; stations: string };
}

/** Tope de tamaño de un snapshot guardado (JSON), para no aceptar cualquier cosa. */
export const MAX_SNAPSHOT_BYTES = 800_000;

const LatLonSchema = z.object({ lat: z.number(), lon: z.number() });

const RawRouteSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    geometry: z.array(LatLonSchema),
    samples: z.array(
      z.object({
        km: z.number(),
        lat: z.number(),
        lon: z.number(),
        elevM: z.number(),
        slopePct: z.number(),
        speedKmh: z.number(),
        speedLimitKmh: z.number().optional(),
        roadTier: z
          .enum(["primary", "secondary", "tertiary", "local", "unpaved", "unknown"])
          .optional(),
      }),
    ),
    distanceKm: z.number(),
    driveMinutes: z.number(),
    elevation: z.object({
      gainM: z.number(),
      lossM: z.number(),
      minM: z.number(),
      maxM: z.number(),
    }),
    via: z.string().optional(),
    noTolls: z.boolean().optional(),
    roadMix: z.record(z.string(), z.number()).optional(),
    hierarchyFactor: z.number().optional(),
    withinTolerance: z.boolean().optional(),
    minorRoadScore: z.number().optional(),
    engine: z.enum(["mapbox-traffic", "mapbox", "osrm"]).optional(),
    legBoundariesKm: z.array(z.number()).optional(),
  })
  .passthrough();

const ChargerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    sockets: z.array(
      z
        .object({
          connector: z.string(),
          powerKw: z.number(),
          count: z.number(),
          current: z.enum(["AC", "DC"]).nullable().optional(),
        })
        .passthrough(),
    ),
    source: z.string(),
  })
  .passthrough();

const WeatherSchema = z
  .object({ temperatureC: z.number(), windKmh: z.number(), windDirDeg: z.number() })
  .passthrough();

const SnapshotObjectSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  createdAt: z.string(),
  modelVersion: z.string(),
  plannerEngine: z.enum(["legacy", "v2"]),
  /** Falta en snapshots anteriores a F5: equivale a "legacy". */
  energyEngine: z.enum(["legacy", "v2"]).optional(),
  providers: z.object({
    routing: z.string(),
    elevation: z.string(),
    weather: z.string().nullable(),
    stations: z.string(),
  }),
  routes: z.array(RawRouteSchema).min(1).max(8),
  chargers: z.array(ChargerSchema).max(2000),
  weather: WeatherSchema.nullable(),
  warnings: z.array(z.string()),
  stationsVersion: z.string().optional(),
});

/**
 * Valida un snapshot que viene de afuera (base de datos, cliente). Solo revisa
 * lo que el planificador lee; el resto de los campos pasa tal cual.
 */
export function parsePlanningSnapshot(value: unknown): PlanningSnapshot | null {
  if (value == null) return null;
  const size = JSON.stringify(value)?.length ?? 0;
  if (size > MAX_SNAPSHOT_BYTES) return null;
  const parsed = SnapshotObjectSchema.safeParse(value);
  return parsed.success ? (parsed.data as unknown as PlanningSnapshot) : null;
}

/** Los datos del snapshot que necesita `computePlans` (sin el origen y el destino, que van en la petición). */
export function snapshotInputs(s: PlanningSnapshot) {
  return { routes: s.routes, chargers: s.chargers, weather: s.weather };
}
