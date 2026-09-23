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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || fileEnv.VITE_MAPBOX_TOKEN || "",
    NEXT_PUBLIC_PLUGSHARE_TOKEN: process.env.NEXT_PUBLIC_PLUGSHARE_TOKEN || fileEnv.VITE_PLUGSHARE_TOKEN || "",
  },
};

export default nextConfig;
