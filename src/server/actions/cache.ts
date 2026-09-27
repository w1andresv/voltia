"use server";

import type { AppInfo } from "@/lib/app-info";

/** Versión del código y configuración del servidor, sin secretos (para comparar entornos). */
export async function appInfoFn(): Promise<AppInfo> {
  const { getEnv } = await import("@/infrastructure/config/env");
  const { buildInfo } = await import("@/infrastructure/config/build-info");
  const { mapboxServerToken } = await import("@/infrastructure/providers/routing.mapbox");
  const { MODEL_PARAMETERS } = await import("@/domain/ev/core/params");
  const { getActor } = await import("@/infrastructure/auth/server-actor");
  const env = getEnv();
  const terrain = MODEL_PARAMETERS.elevation.terrain;
  // El diagnóstico tiene que responder aunque falle la sesión (p. ej. Supabase mal configurado).
  const role = await getActor().then(
    (a) => a.role,
    () => "guest",
  );
  return {
    build: buildInfo(),
    server: {
      plannerEngine: env.PLANNER_ENGINE,
      energyEngine: env.ENERGY_ENGINE,
      elevationSource: env.ELEVATION_SOURCE,
      terrain: `${terrain.tileset} z${terrain.zoom}${terrain.retina ? " @2x" : ""}`,
      detourSource: env.DETOUR_SOURCE,
      blazeConfigured: Boolean(env.BLAZE_API_KEY),
      mapboxConfigured: Boolean(mapboxServerToken()),
    },
    canClearServer: role === "admin",
  };
}

/**
 * Limpia la caché del servidor (solo administradores): invalida en la Data
 * Cache las respuestas con vencimiento (rutas, clima, geocodificación, Blaze,
 * matriz), vacía la memoria de este proceso y olvida el listado de Blaze. La
 * elevación se conserva: el terreno no cambia y volver a pedirlo cuesta.
 */
export async function clearServerCacheFn(): Promise<{ clearedAt: string; memoryEntries: number }> {
  const { requireAdmin } = await import("@/infrastructure/auth/server-actor");
  const actor = await requireAdmin();
  const { updateTag } = await import("next/cache");
  const { PROVIDER_CACHE_TAG, clearProviderMemory } =
    await import("@/infrastructure/providers/http");
  const { resetStationCaches } = await import("@/application/container");
  updateTag(PROVIDER_CACHE_TAG);
  const memoryEntries = clearProviderMemory();
  resetStationCaches();
  console.log(
    `[cache] caché del servidor limpia por ${actor.email}: ${memoryEntries} respuesta(s) en memoria, etiqueta ${PROVIDER_CACHE_TAG} invalidada`,
  );
  return { clearedAt: new Date().toISOString(), memoryEntries };
}
