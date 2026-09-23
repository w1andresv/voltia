"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser client. Uses the publishable key only. Session lives in cookies
 * (not just localStorage), so it's readable by the server on the same
 * request — see src/infrastructure/supabase/server.ts and src/middleware.ts.
 * Returns null until the required keys are configured.
 */
export function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createBrowserClient(url, key);
  }
  return client;
}
