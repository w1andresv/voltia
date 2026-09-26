import "server-only";
import type { Actor } from "@/domain/auth/port";
import { getEnv } from "@/infrastructure/config/env";

/**
 * Selector de motor v1/v2 (vista previa): solo para correos en
 * ENGINE_PREVIEW_EMAILS. La decisión es del servidor: si otro usuario manda la
 * elección a mano, se ignora.
 */
export function canChooseEngine(actor: Pick<Actor, "email" | "role">): boolean {
  if (actor.role === "guest" || !actor.email) return false;
  const allowed = getEnv()
    .ENGINE_PREVIEW_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(actor.email.toLowerCase());
}
