import { z } from "zod";
import { PlanRequestSchema, TripSummarySchema } from "@/domain/schemas";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";

/**
 * Estado del navegador para el flujo "Guardar ruta" (fuera de `voltia-guest`,
 * que solo guarda datos del invitado):
 *  - la elección "guardar sin iniciar sesión", recordada 180 días;
 *  - el guardado pendiente de "Iniciar sesión y guardar": la ruta espera aquí
 *    (no en las rutas del invitado) hasta que haya sesión, y entonces se guarda
 *    directo en la cuenta. Vive en localStorage para que la pestaña que abre el
 *    enlace mágico también pueda completarlo; el clientId lo hace idempotente;
 *  - un "ping" entre pestañas cuando cambia la sesión.
 * Toda lectura/escritura tolera un navegador sin almacenamiento (modo privado).
 */

export const SAVE_CHOICE_KEY = "voltia-save-choice";
export const PENDING_SAVE_KEY = "voltia-pending-save";
export const PENDING_SAVE_DONE_KEY = "voltia-pending-save-done";
export const AUTH_PING_KEY = "voltia-auth-ping";
export const SAVE_CHOICE_DAYS = 180;
/** Un guardado pendiente caduca si nadie inicia sesión en un día. */
export const PENDING_SAVE_TTL_MS = 24 * 3_600_000;

const DAY_MS = 86_400_000;

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): KV | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: KV | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: KV | null, key: string, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(storage: KV | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}

// --- Elección "guardar sin iniciar sesión" ----------------------------------

const ChoiceSchema = z.object({ choice: z.literal("guest"), at: z.string() });

/** true si el invitado eligió "Guardar sin iniciar sesión" hace menos de 180 días. */
export function hasGuestSaveChoice(now = new Date(), storage = browserStorage()): boolean {
  const raw = read(storage, SAVE_CHOICE_KEY);
  if (!raw) return false;
  try {
    const parsed = ChoiceSchema.parse(JSON.parse(raw));
    const at = Date.parse(parsed.at);
    if (Number.isFinite(at) && now.getTime() - at < SAVE_CHOICE_DAYS * DAY_MS) return true;
  } catch {
    /* valor corrupto: se descarta */
  }
  remove(storage, SAVE_CHOICE_KEY);
  return false;
}

export function rememberGuestSaveChoice(now = new Date(), storage = browserStorage()): void {
  write(storage, SAVE_CHOICE_KEY, JSON.stringify({ choice: "guest", at: now.toISOString() }));
}

export function clearGuestSaveChoice(storage = browserStorage()): void {
  remove(storage, SAVE_CHOICE_KEY);
}

// --- Guardado pendiente de iniciar sesión -----------------------------------

const PendingSaveSchema = z.object({
  clientId: z.string().uuid(),
  request: PlanRequestSchema,
  summary: TripSummarySchema,
  createdAt: z.string(),
});

export type PendingSave = {
  clientId: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
  createdAt: string;
};

/** Deja la ruta esperando a que haya sesión. false si el navegador no la pudo guardar. */
export function writePendingSave(
  pending: Omit<PendingSave, "createdAt">,
  now = new Date(),
  storage = browserStorage(),
): boolean {
  return write(
    storage,
    PENDING_SAVE_KEY,
    JSON.stringify({ ...pending, createdAt: now.toISOString() }),
  );
}

export function readPendingSave(now = new Date(), storage = browserStorage()): PendingSave | null {
  const raw = read(storage, PENDING_SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = PendingSaveSchema.parse(JSON.parse(raw)) as PendingSave;
    const at = Date.parse(parsed.createdAt);
    if (Number.isFinite(at) && now.getTime() - at < PENDING_SAVE_TTL_MS) return parsed;
  } catch {
    /* corrupto */
  }
  remove(storage, PENDING_SAVE_KEY);
  return null;
}

/**
 * Toma el pendiente y lo quita del almacenamiento, para que otra pestaña no
 * lo guarde a la vez (si igual ocurriera, el clientId evita el duplicado).
 */
export function claimPendingSave(now = new Date(), storage = browserStorage()): PendingSave | null {
  const pending = readPendingSave(now, storage);
  if (pending) remove(storage, PENDING_SAVE_KEY);
  return pending;
}

/** Vuelve a dejar un pendiente reclamado cuyo guardado falló (conserva su fecha). */
export function restorePendingSave(pending: PendingSave, storage = browserStorage()): void {
  write(storage, PENDING_SAVE_KEY, JSON.stringify(pending));
}

/** Descarta el pendiente (Cancelar). Con `clientId`, solo si sigue siendo ese. */
export function clearPendingSave(clientId?: string, storage = browserStorage()): void {
  if (clientId) {
    const raw = read(storage, PENDING_SAVE_KEY);
    try {
      if (raw && JSON.parse(raw)?.clientId !== clientId) return;
    } catch {
      /* corrupto: se borra */
    }
  }
  remove(storage, PENDING_SAVE_KEY);
}

/** Marca un pendiente como guardado en la cuenta (lo ven todas las pestañas). */
export function markPendingSaveDone(clientId: string, storage = browserStorage()): void {
  write(storage, PENDING_SAVE_DONE_KEY, clientId);
}

export function isPendingSaveDone(clientId: string, storage = browserStorage()): boolean {
  return read(storage, PENDING_SAVE_DONE_KEY) === clientId;
}

// --- Sincronía de sesión entre pestañas --------------------------------------

/** Avisa a las otras pestañas de que la sesión cambió (evento `storage`). */
export function pingAuthChange(storage = browserStorage()): void {
  write(storage, AUTH_PING_KEY, String(Date.now()));
}
