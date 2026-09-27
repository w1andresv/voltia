import "server-only";
import { execSync } from "node:child_process";

/**
 * Qué versión del código responde: en Vercel, el commit y la rama del
 * despliegue (variables de sistema de Vercel); en local, lo que diga git.
 * Sirve para comparar entornos (p. ej. localhost contra Vercel) sin adivinar.
 */
export interface BuildInfo {
  commit: string;
  branch: string | null;
  /** production | preview | development en Vercel; "local" fuera de Vercel. */
  environment: string;
}

let local: { commit: string | null; branch: string | null } | null = null;

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function localGit() {
  local ??= { commit: git("rev-parse --short HEAD"), branch: git("rev-parse --abbrev-ref HEAD") };
  return local;
}

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  if (env.VERCEL) {
    return {
      commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "desconocido",
      branch: env.VERCEL_GIT_COMMIT_REF || null,
      environment: env.VERCEL_ENV || "vercel",
    };
  }
  const g = localGit();
  return { commit: g.commit ?? "desconocido", branch: g.branch, environment: "local" };
}
