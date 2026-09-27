/**
 * Qué versión y qué configuración responde en este entorno (sin secretos).
 * Lo arma `appInfoFn` en el servidor; la UI lo muestra en "Diagnóstico y caché"
 * para comparar entornos, p. ej. localhost contra Vercel.
 */
export interface AppInfo {
  build: { commit: string; branch: string | null; environment: string };
  server: {
    /** PLANNER_ENGINE: el que responde a quien no puede elegir motor y a /planificar. */
    plannerEngine: string;
    energyEngine: string;
    elevationSource: string;
    /** Tileset, zoom y tamaño de las teselas de terreno, p. ej. "mapbox.terrain-rgb z11 @2x". */
    terrain: string;
    detourSource: string;
    blazeConfigured: boolean;
    mapboxConfigured: boolean;
  };
  /** Si el usuario puede limpiar también la caché del servidor (administradores). */
  canClearServer: boolean;
}
