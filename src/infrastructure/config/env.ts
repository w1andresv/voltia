import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().default(""),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().default(""),
  SUPABASE_SECRET_KEY: z.string().default(""),
  DATABASE_URL: z.string().default(""),
  PLUGSHARE_TOKEN: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  /** Motor de planificación: legacy (actual), shadow (ambos, responde el actual) o v2 (plan §6). */
  PLANNER_ENGINE: z.enum(["legacy", "shadow", "v2"]).default("legacy").catch("legacy"),
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
    PLANNER_ENGINE: process.env.PLANNER_ENGINE?.trim() || undefined,
  });
  return cached;
}

export function authClientConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
