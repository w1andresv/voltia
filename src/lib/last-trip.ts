import { PlaceSchema, TripConditionsSchema, VehicleSchema } from "@/domain/schemas";
import type { GeoBundle, Place, TripConditions, Vehicle } from "@/domain/types";

/**
 * El último plan calculado, guardado en este navegador para abrirlo sin
 * conexión (PWA). Con el `geo` (rutas con elevación, estaciones y clima) los
 * planes se recalculan en el navegador sin consultar proveedores. Pesa
 * ~150–300 KB: va en localStorage (~5 MB por sitio) y, si no cabe, no se guarda.
 */
export interface LastTrip {
  savedAt: string;
  origin: Place;
  destination: Place;
  waypoints: Place[];
  vehicle: Vehicle;
  conditions: TripConditions;
  geo: GeoBundle;
  selectedPlanId: string | null;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "voltia-last-trip";
/** Subirla si cambia la forma guardada: lo anterior se descarta al leer. */
const VERSION = 1;
/** Por encima de esto no se guarda: deja lugar a los vehículos y viajes del invitado. */
export const MAX_LAST_TRIP_CHARS = 2_000_000;

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Guarda el viaje; false si no hay almacenamiento, no cabe o el navegador lo rechaza. */
export function saveLastTrip(
  trip: LastTrip,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const json = JSON.stringify({ v: VERSION, ...trip });
    if (json.length > MAX_LAST_TRIP_CHARS) return false;
    storage.setItem(KEY, json);
    return true;
  } catch {
    return false;
  }
}

/** El viaje guardado, o null si no hay, es de otra versión o no tiene la forma esperada. */
export function loadLastTrip(storage: KeyValueStorage | null = browserStorage()): LastTrip | null {
  let raw: unknown;
  try {
    const text = storage?.getItem(KEY);
    if (!text) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const t = raw as Partial<LastTrip> & { v?: unknown };
  if (t?.v !== VERSION || typeof t.savedAt !== "string") return null;
  const origin = PlaceSchema.safeParse(t.origin);
  const destination = PlaceSchema.safeParse(t.destination);
  const waypoints = PlaceSchema.array().safeParse(t.waypoints ?? []);
  const vehicle = VehicleSchema.safeParse(t.vehicle);
  const conditions = TripConditionsSchema.safeParse(t.conditions);
  const geo = t.geo;
  if (
    !origin.success ||
    !destination.success ||
    !waypoints.success ||
    !vehicle.success ||
    !conditions.success ||
    !Array.isArray(geo?.routes) ||
    !geo.routes.length ||
    !Array.isArray(geo.chargers)
  ) {
    return null;
  }
  return {
    savedAt: t.savedAt,
    origin: origin.data,
    destination: destination.data,
    waypoints: waypoints.data,
    vehicle: vehicle.data as Vehicle,
    conditions: conditions.data as TripConditions,
    geo,
    selectedPlanId: typeof t.selectedPlanId === "string" ? t.selectedPlanId : null,
  };
}

export function clearLastTrip(storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}
