import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const SUPABASE_URL = "https://iabzaowkbnxczwguhceb.supabase.co";

function grokAppEnv(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(process.cwd(), ".grok/app-env.json"), "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = grokAppEnv();

const resolvedSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL;

/** Host (e.g. "xyz.supabase.co"), for the CSP below. Falls back gracefully if the URL is malformed. */
function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const supabaseHost = safeHost(resolvedSupabaseUrl);

/**
 * Cabeceras de seguridad (fase 1 del plan). script-src conserva
 * 'unsafe-inline'/'unsafe-eval' porque Next.js e hidratación los necesitan
 * en algunos casos; no se pudo probar esta CSP contra un navegador real
 * en el entorno donde se escribió (sin salida de red a Mapbox/Supabase),
 * así que conviene revisarla en la consola del navegador después de
 * desplegar, antes de endurecer script-src.
 */
function cspHeaderValue(): string {
  const supabase = supabaseHost ? `https://${supabaseHost} wss://${supabaseHost}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https://api.mapbox.com${supabaseHost ? ` https://${supabaseHost}` : ""}`,
    `connect-src 'self' https://api.mapbox.com${supabase ? ` ${supabase}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: resolvedSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || fileEnv.VITE_MAPBOX_TOKEN || "",
    // PLUGSHARE_TOKEN (sin NEXT_PUBLIC_) es server-only: ver src/infrastructure/config/env.ts.
    // El operador nunca lo manda al navegador; cada usuario puede pegar su
    // propia clave en Configuración > PlugShare si quiere.
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeaderValue() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
