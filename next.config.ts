import type { NextConfig } from "next";

/** Host (e.g. "xyz.supabase.co"), for the CSP below. Falls back gracefully if the URL is malformed. */
function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const supabaseHost = safeHost(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

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
