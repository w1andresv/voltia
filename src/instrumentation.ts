/**
 * Arranque del servidor Next.js (instrumentation.ts, estable desde Next 15):
 * Next llama a register() una sola vez por instancia, antes de servir la
 * primera petición — nunca en el runtime edge ni en el navegador.
 *
 * El catálogo de vehículos YA NO se siembra aquí: es un archivo SQL
 * rerunnable (seeds/0001_vehicle_catalog.sql) que se aplica con
 * `npm run db:seed`, aparte de las migraciones.
 */
export async function register(): Promise<void> {
  // Dataset de electrolineras: solo memoria <- Postgres, nunca llama a las
  // fuentes externas aquí (no bloquea el arranque de la instancia).
  const { preloadStationDataset } = await import("@/infrastructure/stations/service");
  await preloadStationDataset();
}
