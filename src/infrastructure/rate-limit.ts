import "server-only";
import { headers } from "next/headers";
import { getSql } from "@/lib/db";

/** Best-effort caller IP from the proxy headers Vercel (and most hosts) set. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export class RateLimitError extends Error {
  constructor(message = "Demasiadas solicitudes. Espera un minuto e intenta de nuevo.") {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Fixed-window rate limit backed by the app's own Postgres (table
 * `rate_limits`, migration 0005) — no extra service to run. `bucket` scopes
 * the limit to one action ("plan-trip", "create-station"), `key` is usually
 * the caller's IP or user id. One UPSERT does the read-check-increment
 * atomically, so concurrent requests from the same key can't race past the
 * limit. Throws RateLimitError when the caller is already over `limit`.
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const sql = await getSql();
  const rows = await sql.query<{ count: number }>(
    `insert into rate_limits (key, window_start, count)
     values ($1, now(), 1)
     on conflict (key) do update set
       count = case
         when rate_limits.window_start < now() - make_interval(secs => $2::double precision) then 1
         else rate_limits.count + 1
       end,
       window_start = case
         when rate_limits.window_start < now() - make_interval(secs => $2::double precision) then now()
         else rate_limits.window_start
       end
     returning count`,
    [`${bucket}:${key}`, windowSeconds],
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new RateLimitError();
  }
}
