import "server-only";
import { cache } from "react";
import { getEnv } from "@/infrastructure/config/env";
import { supabaseIdentity } from "@/infrastructure/auth/supabase-identity";
import { ensureUser } from "@/infrastructure/users/user-store";
import type { Actor } from "@/domain/auth/port";

const guest: Actor = { role: "guest", id: null, email: null };

function adminEmails(): Set<string> {
  return new Set(
    getEnv()
      .ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resuelve al que llama: identidad verificada por el proveedor (ver
 * supabase-identity.ts) → id interno de public.voltia_users (alta perezosa si aún no
 * existe, p. ej. una sesión anterior a esta tabla). `actor.id` es SIEMPRE el
 * id interno, nunca el del proveedor. Con `cache()`, una consulta por request.
 *
 * `role: "admin"` es quien tenga su correo verificado en ADMIN_EMAILS. Para una
 * lista corta y mantenida a mano basta; pasa a una tabla si crece.
 */
export const getActor = cache(async (): Promise<Actor> => {
  const identity = await supabaseIdentity.currentIdentity();
  if (!identity) return guest;

  const id = await ensureUser(identity);
  const isAdmin = adminEmails().has(identity.email.toLowerCase());
  return { role: isAdmin ? "admin" : "member", id, email: identity.email };
});

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Lanza si no hay sesión. Devuelve el actor member/admin con el id interno. */
export async function requireUser(): Promise<Actor> {
  const actor = await getActor();
  if (actor.role === "guest") throw new AuthError("Inicia sesión para continuar.");
  return actor;
}

/** @deprecated alias temporal de requireUser(). */
export const requireMember = requireUser;

/** Lanza salvo que el correo del que llama esté en ADMIN_EMAILS. */
export async function requireAdmin(): Promise<Actor> {
  const actor = await getActor();
  if (actor.role !== "admin") throw new AuthError("No autorizado.");
  return actor;
}
