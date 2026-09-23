import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/infrastructure/config/env";

/**
 * Server-side Supabase client bound to the request's cookies. Reads and
 * refreshes the session on the server (Server Components, Route Handlers,
 * Server Actions). Uses the publishable key only — never the secret key.
 *
 * In a Server Component, `setAll` is a no-op (cookies can't be written
 * there): `src/middleware.ts` is what actually refreshes the session cookie
 * on each request. Route Handlers and Server Actions can write cookies
 * directly, so `setAll` works there.
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const env = getEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: ignored. The middleware
          // refreshes the session cookie on the next request instead.
        }
      },
    },
  });
}
