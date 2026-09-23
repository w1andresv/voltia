import { NextResponse } from "next/server";
import { createServerSupabase } from "@/infrastructure/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PKCE callback for Supabase OAuth (Google). `signInWithOAuth` in
 * src/infrastructure/auth/supabase-auth.ts sends the browser here with a
 * `code` param; this exchanges it for a session, stored in cookies by
 * createServerSupabase's `setAll` (a Route Handler can write cookies).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/?auth_error=1", url.origin));
}
