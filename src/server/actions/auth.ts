"use server";

import { getActor } from "@/infrastructure/auth/server-actor";
import type { Actor } from "@/domain/auth/port";

/**
 * Actor as resolved on the server (cookie-verified against Supabase, see
 * getActor()). Safe to expose: only role/id/email, no secrets. The client
 * uses this for UI only (show/hide the moderation controls) — every
 * server action re-checks the session itself, so a stale or spoofed client
 * value can't grant access.
 */
export async function getActorFn(): Promise<Actor> {
  return getActor();
}
