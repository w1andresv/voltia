/**
 * Arranque del servidor Next.js (instrumentation.ts, estable desde Next 15):
 * Next llama a register() una sola vez por instancia, antes de servir la
 * primera petición — nunca en el runtime edge ni en el navegador. Es el
 * lugar correcto para sembrar el catálogo de vehículos (antes vivía en
 * GET /api/health, que se llama en cada healthcheck y no debe escribir
 * datos — ver "Riesgos y checklist final" del plan).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL?.trim()) return;

  try {
    const { ensureCatalogSeed } = await import("@/infrastructure/db/seed-catalog");
    const count = await ensureCatalogSeed();
    console.log(`[instrumentation] catálogo de vehículos: ${count} sembrados/actualizados`);
  } catch (error) {
    // No tumba el arranque del servidor por un problema transitorio de BD;
    // el catálogo se reintenta en la siguiente instancia/cold start.
    console.error("[instrumentation] no se pudo sembrar el catálogo", error instanceof Error ? error.message : error);
  }
}
