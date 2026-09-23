import { z } from "zod";
import { PlanRequestSchema, TripSummarySchema, VehicleSchema } from "@/domain/schemas";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import type { Vehicle } from "@/domain/types";

export const GUEST_KEY = "voltia-guest";
export const GUEST_CORRUPT_KEY = "voltia-guest-corrupt";
export const GUEST_VERSION = 1;
export const MAX_GUEST_VEHICLES = 20;
export const MAX_GUEST_TRIPS = 50;
export const GUEST_EXPIRY_DAYS = 180;

const DAY_MS = 86_400_000;

const GuestTripSchema = z.object({
  clientId: z.string().uuid(),
  request: PlanRequestSchema,
  summary: TripSummarySchema,
  createdAt: z.string(),
});

const GuestDataSchema = z.object({
  v: z.literal(GUEST_VERSION),
  guestId: z.string().min(1),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  vehicles: z.array(VehicleSchema),
  trips: z.array(GuestTripSchema),
  migration: z
    .object({
      userId: z.string(),
      attempts: z.number().int().min(0),
      lastAttemptAt: z.string(),
      pending: z.array(z.string()),
    })
    .optional(),
});

export type GuestTrip = {
  clientId: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
  createdAt: string;
};
export type GuestData = z.infer<typeof GuestDataSchema>;

/** Resultado de una escritura: `ok: false` con `reason` cuando el navegador la rechaza o se llegó a un límite. */
export type WriteResult = { ok: true } | { ok: false; reason: "quota" | "limit" | "unavailable" };

export class GuestLimitError extends Error {
  constructor(readonly kind: "vehicles" | "trips") {
    super(
      kind === "vehicles"
        ? `Llegaste al límite de ${MAX_GUEST_VEHICLES} vehículos sin cuenta. Inicia sesión para guardar más.`
        : `Llegaste al límite de ${MAX_GUEST_TRIPS} rutas sin cuenta. Inicia sesión para guardar más.`,
    );
    this.name = "GuestLimitError";
  }
}

/** Storage mínimo que necesitamos (compatible con `window.localStorage` y con un doble en pruebas). */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function newGuestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  // Respaldo para contextos sin randomUUID (http no seguro): no identifica a nadie fuera del navegador.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newClientId(): string {
  return newGuestId();
}

function freshGuest(now: Date): GuestData {
  const iso = now.toISOString();
  return {
    v: GUEST_VERSION,
    guestId: newGuestId(),
    createdAt: iso,
    lastActiveAt: iso,
    vehicles: [],
    trips: [],
  };
}

export interface GuestStorage {
  /** Lee (y valida) el invitado; crea uno nuevo si falta, expiró o estaba corrupto. */
  load(): GuestData;
  save(data: GuestData): WriteResult;
  /** Borra `voltia-guest` (las preferencias de `voltia-planner` no se tocan). */
  clear(): void;
  addVehicle(v: Vehicle): GuestData;
  removeVehicle(id: string): GuestData;
  addTrip(t: { clientId: string; request: PlanRequestShape; summary: TripSummaryShape }): GuestData;
  removeTrip(clientId: string): GuestData;
}

/**
 * `voltia-guest`: todo lo del invitado, en `localStorage` y no en cookies
 * (viajarían en cada request y no pasan de ~4 KB). Si el navegador rechaza la
 * escritura (cuota, modo privado) la app sigue en memoria: `memory` guarda la
 * última versión y `onWriteFailed` avisa una sola vez.
 */
export function createGuestStorage(
  options: {
    storage?: StorageLike | null;
    now?: () => Date;
    onWriteFailed?: (reason: "quota" | "unavailable") => void;
  } = {},
): GuestStorage {
  const now = options.now ?? (() => new Date());
  const resolveStorage = () => (options.storage === undefined ? browserStorage() : options.storage);
  let memory: GuestData | null = null;
  let warned = false;

  function warn(reason: "quota" | "unavailable") {
    if (warned) return;
    warned = true;
    options.onWriteFailed?.(reason);
  }

  function persist(data: GuestData): WriteResult {
    memory = data;
    const storage = resolveStorage();
    if (!storage) {
      warn("unavailable");
      return { ok: false, reason: "unavailable" };
    }
    try {
      storage.setItem(GUEST_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (error) {
      const reason = isQuotaError(error) ? "quota" : "unavailable";
      warn(reason);
      return { ok: false, reason };
    }
  }

  function load(): GuestData {
    const storage = resolveStorage();
    let raw: string | null = null;
    try {
      raw = storage?.getItem(GUEST_KEY) ?? null;
    } catch {
      raw = null;
    }

    if (raw == null) {
      const data = memory ?? freshGuest(now());
      if (!memory) persist(data);
      return data;
    }

    let parsed: GuestData | null = null;
    try {
      const result = GuestDataSchema.safeParse(JSON.parse(raw));
      parsed = result.success ? result.data : null;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      // Datos corruptos o de una versión desconocida: se apartan para diagnóstico.
      try {
        storage?.setItem(GUEST_CORRUPT_KEY, raw);
      } catch {
        // Sin cuota para el respaldo: se sigue sin él.
      }
      const data = freshGuest(now());
      persist(data);
      return data;
    }

    const ageDays = (now().getTime() - new Date(parsed.lastActiveAt).getTime()) / DAY_MS;
    if (Number.isFinite(ageDays) && ageDays > GUEST_EXPIRY_DAYS) {
      const data = freshGuest(now());
      persist(data);
      return data;
    }

    // lastActiveAt se actualiza como mucho una vez al día.
    if (!Number.isFinite(ageDays) || ageDays >= 1) {
      parsed = { ...parsed, lastActiveAt: now().toISOString() };
      persist(parsed);
    } else {
      memory = parsed;
    }
    return parsed;
  }

  function mutate(change: (d: GuestData) => GuestData): GuestData {
    const next = change(load());
    persist(next);
    return next;
  }

  return {
    load,
    save: persist,
    clear() {
      memory = null;
      try {
        resolveStorage()?.removeItem(GUEST_KEY);
      } catch {
        // nada que borrar
      }
    },
    addVehicle(v) {
      return mutate((d) => {
        const exists = d.vehicles.some((x) => x.id === v.id);
        if (!exists && d.vehicles.length >= MAX_GUEST_VEHICLES)
          throw new GuestLimitError("vehicles");
        return {
          ...d,
          vehicles: exists ? d.vehicles.map((x) => (x.id === v.id ? v : x)) : [...d.vehicles, v],
        };
      });
    },
    removeVehicle(id) {
      return mutate((d) => ({ ...d, vehicles: d.vehicles.filter((x) => x.id !== id) }));
    },
    addTrip(t) {
      return mutate((d) => {
        if (d.trips.some((x) => x.clientId === t.clientId)) return d;
        // Con 50 rutas no se borra nada sin decirlo: se rechaza y se ofrece iniciar sesión.
        if (d.trips.length >= MAX_GUEST_TRIPS) throw new GuestLimitError("trips");
        return { ...d, trips: [...d.trips, { ...t, createdAt: now().toISOString() }] };
      });
    },
    removeTrip(clientId) {
      return mutate((d) => ({ ...d, trips: d.trips.filter((x) => x.clientId !== clientId) }));
    },
  };
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? "";
  const code = (error as { code?: number }).code;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}
