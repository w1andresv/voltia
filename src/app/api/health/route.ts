import { authClientConfigured, getEnv } from "@/infrastructure/config/env";
import { getSql } from "@/infrastructure/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  let host = "";
  try {
    host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
  } catch {
    host = "";
  }

  let authReachable = false;
  let googleEnabled = false;
  if (authClientConfigured()) {
    try {
      const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
        headers: {
          apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
        },
        cache: "no-store",
      });
      authReachable = response.ok;
      if (response.ok) {
        const body = (await response.json()) as { external?: { google?: boolean } };
        googleEnabled = Boolean(body.external?.google);
      }
    } catch {
      authReachable = false;
    }
  }

  // Solo lectura: sembrar el catálogo aquí lo repetiría en cada healthcheck.
  // Eso ahora pasa una sola vez por instancia en src/instrumentation.ts.
  let database = false;
  let catalog = 0;
  if (env.DATABASE_URL) {
    try {
      const sql = await getSql();
      await sql.query("select 1 as ok");
      const rows = await sql.query<{ count: number }>(
        "select count(*)::int as count from voltia.vehicles where owner_id is null",
      );
      catalog = rows[0]?.count ?? 0;
      database = true;
    } catch (error) {
      console.error("[health] database unavailable", error instanceof Error ? error.name : "error");
      database = false;
    }
  }

  return Response.json({
    ok: true,
    framework: "next",
    supabaseHost: host,
    auth: authReachable,
    google: googleEnabled,
    database,
    catalog,
    plugshare: Boolean(env.PLUGSHARE_TOKEN),
  });
}
