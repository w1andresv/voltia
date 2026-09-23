import "server-only";
import { createServerSupabase } from "@/infrastructure/supabase/server";
import { getEnv } from "@/infrastructure/config/env";
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
 * Resolves the current actor from the request's Supabase session cookie.
 * Uses `getUser()`, never `getSession()`: `getSession()` trusts whatever is
 * in the cookie, while `getUser()` revalidates the token against Supabase's
 * auth server, so it can't be spoofed by an edited cookie.
 *
 * `role: "admin"` is anyone whose verified email is in ADMIN_EMAILS. That's
 * fine for a short, hand-maintained list; move to a table (or
 * app_metadata.role set server-side) if the list grows.
 */
export async function getActor(): Promise<Actor> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return guest;

  const email = user.email ?? null;
  const isAdmin = Boolean(email && adminEmails().has(email.toLowerCase()));
  return { role: isAdmin ? "admin" : "member", id: user.id, email };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Throws unless the caller has a session. Returns the member/admin actor. */
export async function requireMember(): Promise<Actor> {
  const actor = await getActor();
  if (actor.role === "guest") throw new AuthError("Inicia sesión para continuar.");
  return actor;
}

/** Throws unless the caller's email is in ADMIN_EMAILS. */
export async function requireAdmin(): Promise<Actor> {
  const actor = await getActor();
  if (actor.role !== "admin") throw new AuthError("No autorizado.");
  return actor;
}
