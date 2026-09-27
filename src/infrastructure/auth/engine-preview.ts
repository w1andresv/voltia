import "server-only";
import type { Actor } from "@/domain/auth/port";
import { getEnv } from "@/infrastructure/config/env";

/** Valor de ENGINE_PREVIEW_EMAILS que abre el selector a todos, invitados incluidos. */
export const EVERYONE = "*";

/**
 * Selector de motor v1/v2 (vista previa). Con ENGINE_PREVIEW_EMAILS="*" (por
 * defecto) lo ve todo el mundo; con una lista de correos, solo esas cuentas.
 * La decisión es del servidor: si alguien no autorizado manda la elección a
 * mano, se ignora.
 */
export function canChooseEngine(actor: Pick<Actor, "email" | "role">): boolean {
  const allowed = getEnv()
    .ENGINE_PREVIEW_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.includes(EVERYONE)) return true;
  if (actor.role === "guest" || !actor.email) return false;
  return allowed.includes(actor.email.toLowerCase());
}
