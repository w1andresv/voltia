import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().default(""),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().default(""),
  SUPABASE_SECRET_KEY: z.string().default(""),
  DATABASE_URL: z.string().default(""),
  PLUGSHARE_TOKEN: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  /**
   * Correos (separados por coma) que ven el selector de motor v1/v2 en el
   * planificador. Por defecto, solo el dueño del producto.
   */
  ENGINE_PREVIEW_EMAILS: z.string().default("*"),
  /** Motor de planificación: legacy (actual), shadow (ambos, responde el actual) o v2 (plan §6). */
  PLANNER_ENGINE: z.enum(["legacy", "shadow", "v2"]).default("legacy").catch("legacy"),
  /**
   * Fuente de elevación (ADR-0011): mapbox-terrain (por defecto desde D1: teselas
   * cada 100 m, con caché sin vencimiento; sin token de Mapbox cae a open-meteo),
   * open-meteo (96 puntos por ruta) u open-meteo-adaptive.
   */
  /** Modelo de energía (ADR-0012): legacy (actual), shadow (ambos, responde el actual y registra diferencias) o v2. */
  ENERGY_ENGINE: z.enum(["legacy", "shadow", "v2"]).default("legacy").catch("legacy"),
  /** Desvíos a las estaciones (F4): estimated (línea recta, por defecto) o matrix (medidos con la matriz de Mapbox). */
  DETOUR_SOURCE: z.enum(["estimated", "matrix"]).default("estimated").catch("estimated"),
  ELEVATION_SOURCE: z
    .enum(["open-meteo", "open-meteo-adaptive", "mapbox-terrain"])
    .default("mapbox-terrain")
    .catch("mapbox-terrain"),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;

/** Only server code reads this. The browser never sees the database URL. */
export function getEnv(): AppEnv {
  if (cached) return cached;
  cached = EnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY?.trim() ?? "",
    DATABASE_URL: process.env.DATABASE_URL?.trim() ?? "",
    PLUGSHARE_TOKEN: process.env.PLUGSHARE_TOKEN ?? "",
    ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "",
    ENGINE_PREVIEW_EMAILS: process.env.ENGINE_PREVIEW_EMAILS?.trim() || undefined,
    PLANNER_ENGINE: process.env.PLANNER_ENGINE?.trim() || undefined,
    ELEVATION_SOURCE: process.env.ELEVATION_SOURCE?.trim() || undefined,
    ENERGY_ENGINE: process.env.ENERGY_ENGINE?.trim() || undefined,
    DETOUR_SOURCE: process.env.DETOUR_SOURCE?.trim() || undefined,
  });
  return cached;
}

export function authClientConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
