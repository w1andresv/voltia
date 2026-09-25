/**
 * Carga .env.local y .env de la raíz del proyecto en process.env (como hace Next.js),
 * para que `npm run db:migrate` / `db:seed` vean DATABASE_URL sin exportarla a mano.
 * Prioridad: variables ya definidas en el entorno > .env.local > .env
 * (process.loadEnvFile nunca pisa una variable existente).
 * Requiere Node >= 20.12; en versiones anteriores se omite y hay que exportar las variables.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (typeof process.loadEnvFile === "function") {
  for (const name of [".env.local", ".env"]) {
    const file = join(root, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
