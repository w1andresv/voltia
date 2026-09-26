import type { BodyType } from "../../types";
import type { RoadTier } from "../../road-hierarchy";
import type { RegenAcceptance } from "../contracts/soc";
import { sourced, type SourcedValue } from "./provenance";

/**
 * Parámetros del modelo, centralizados y versionados (especificación v2, §7).
 * Cambiar un valor cambia resultados: se sube `modelVersion` y se explica en el commit.
 */
export interface ModelParameters {
  /** Versión del modelo con que se calcula un plan (se guardará con los viajes). */
  modelVersion: string;
  vehicle: {
    /** Cd·A (m²) y Crr por carrocería cuando el vehículo no trae los suyos (ADR-0002). */
    bodyTypePhysics: SourcedValue<
      Record<BodyType, { dragAreaM2: number; rollingResistance: number }>
    >;
    /** Carrocería supuesta cuando el vehículo no declara una. */
    defaultBodyType: BodyType;
  };
  elevation: {
    /** Puntos de elevación consultados por ruta (hasta 100 por consulta en Open-Meteo). */
    probesPerRoute: number;
    /** Ventana de la media móvil sobre las muestras, en muestras. */
    smoothingWindow: number;
    /** Desnivel mínimo entre muestras para contar como subida o bajada, m. */
    gainThresholdM: number;
    /** Malla por distancia (ELEVATION_SOURCE=mapbox-terrain): un punto cada `spacingM`. */
    mesh: { spacingM: number };
    /**
     * Malla adaptativa (ELEVATION_SOURCE=open-meteo-adaptive): primero un punto
     * cada `coarseSpacingM`; donde la altura cambia más de `refineDeltaM` entre
     * dos puntos, se densifica a `fineSpacingM`. Tope de `maxProbes` por ruta.
     */
    adaptive: {
      coarseSpacingM: number;
      fineSpacingM: number;
      refineDeltaM: number;
      maxProbes: number;
    };
    /** Perfil denso (malla o adaptativa): suavizado por distancia y umbral de histéresis del desnivel. */
    dense: { smoothingM: number; hysteresisM: number };
    /** Teselas de terreno de Mapbox: zoom (12 ≈ 38 m por píxel en el ecuador) y tileset. */
    terrain: { zoom: number; tileset: string };
    /**
     * Pendiente máxima creíble entre puntos del perfil denso, %. Más que esto es
     * un error del modelo de terreno (p. ej. un puente sobre un valle) y se recorta.
     */
    maxGradePct: number;
  };
  soc: {
    /** Regeneración que acepta la batería según su SOC: completa hasta 80 %, cero desde 98 %. */
    regenAcceptance: RegenAcceptance;
  };
  corridor: {
    /** Distancia máxima de una estación a la ruta para considerarla. */
    maxFromRouteKm: number;
    /** Distancia a la ruta que se prefiere al elegir parada. */
    preferredFromRouteKm: number;
    /** Desvío estimado = 2 × distancia a la ruta × este factor (sin matriz de rutas). */
    detourRoadFactor: SourcedValue<number>;
  };
  charging: {
    /** Minutos fijos por parada: estacionar, abrir la app, conectar, desconectar y salir. */
    connectionOverheadMin: SourcedValue<number>;
    /** Paso de la integración de la curva de carga, en puntos de SOC. */
    integrationStepPct: number;
  };
  planner: {
    /** Tope de seguridad de paradas por ruta. */
    maxStops: number;
    /** Avance mínimo entre paradas consecutivas. */
    minProgressKm: number;
    /** Velocidad supuesta en el desvío hasta un cargador. */
    detourSpeedKmh: number;
    /** Margen para comparar SOC calculados (redondeo de punto flotante). */
    socTolerancePct: number;
    /** Piso de SOC con "permitir bajar del margen". */
    belowSafetyFloorPct: number;
    /** Planificador v2: resolución del SOC de salida, en puntos. */
    socGridPct: number;
    /** Planificador v2: minutos de espera supuestos en una estación reportada ocupada. */
    occupiedWaitMin: SourcedValue<number>;
    /** Pasada 2: rutas reales que se piden como máximo para verificar un plan (especificación §4). */
    maxVerifyIterations: number;
  };
  speed: {
    /** Malla del perfil de velocidad y de los tramos de energía v2, m. */
    meshSpacingM: number;
    /** Distancia entre los tres puntos con que se mide el radio de una curva, m. */
    curvatureSpanM: number;
    /** Tope por clase vial cuando el proveedor no da el límite legal, km/h (D8). `unknown` sin tope. */
    defaultByRoadTier: SourcedValue<Partial<Record<RoadTier, number>>>;
    /** Por modo de conducción (especificación §5.3). `targetSpeedFactor` escala la velocidad típica; nunca supera el límite legal. */
    modes: SourcedValue<
      Record<
        "efficient" | "normal" | "sport",
        {
          targetSpeedFactor: number;
          maxAccelMs2: number;
          maxDecelMs2: number;
          maxLateralAccelMs2: number;
        }
      >
    >;
  };
  energy: {
    /** Valores por defecto de la física del vehículo cuando el vehículo no trae los suyos (F5). */
    vehicleDefaults: {
      rotationalInertiaFactor: SourcedValue<number>;
      drivetrainEfficiency: SourcedValue<number>;
      regenEfficiency: SourcedValue<number>;
      maxRegenPowerKw: SourcedValue<number>;
      baseAuxPowerKw: SourcedValue<number>;
    };
    /**
     * Regeneración por modo: fracción del frenado que va al motor (el resto, a los
     * frenos de fricción) y fracción de la potencia máxima de regeneración que se usa.
     */
    regenModes: SourcedValue<
      Record<"low" | "medium" | "high", { captureFraction: number; maxPowerFraction: number }>
    >;
    /** Velocidad a la que se supone medido el consumo manual del usuario, km/h. */
    manualReferenceSpeedKmh: number;
    /**
     * Pérdida de eficiencia de la tracción por temperatura (D4): [°C, factor]; la
     * energía de tracción se divide por la eficiencia y se multiplica por el
     * factor interpolado. Es el `EfficiencyModel` de la especificación §5.4.
     */
    temperatureFactor: SourcedValue<[number, number][]>;
  };
  chart: {
    /** Ventana de la gráfica de consumo según el largo de la ruta (especificación §5.10). */
    windows: { upToKm: number; windowKm: number }[];
  };
  planning: {
    /** Margen de energía extra al planificar (0 hasta calibrar; plan §3.4). */
    energyMarginPercent: number;
  };
}

export const MODEL_PARAMETERS: ModelParameters = {
  modelVersion: "0.1.0-legacy",
  vehicle: {
    bodyTypePhysics: sourced(
      {
        sedan: { dragAreaM2: 0.55, rollingResistance: 0.009 },
        suv_compact: { dragAreaM2: 0.75, rollingResistance: 0.009 },
        suv_large: { dragAreaM2: 0.95, rollingResistance: 0.01 },
      },
      "estimated",
      { reference: "docs/adr/0002-cda-crr-por-carroceria.md" },
    ),
    defaultBodyType: "suv_compact",
  },
  elevation: {
    probesPerRoute: 96,
    smoothingWindow: 5,
    gainThresholdM: 2,
    mesh: { spacingM: 100 },
    adaptive: { coarseSpacingM: 1000, fineSpacingM: 200, refineDeltaM: 15, maxProbes: 1500 },
    dense: { smoothingM: 300, hysteresisM: 5 },
    terrain: { zoom: 12, tileset: "mapbox.terrain-rgb" },
    maxGradePct: 15,
  },
  soc: {
    regenAcceptance: { fullBelowPct: 80, zeroFromPct: 98 },
  },
  corridor: {
    maxFromRouteKm: 12,
    preferredFromRouteKm: 5,
    detourRoadFactor: sourced(1, "estimated", {
      notes: "Línea recta ida y vuelta; se reemplaza con la matriz de rutas.",
    }),
  },
  charging: {
    connectionOverheadMin: sourced(5, "estimated", {
      notes:
        "Estacionar, app, conectar, desconectar y salir. Decisión del producto; calibrar con paradas reales.",
    }),
    integrationStepPct: 0.5,
  },
  planner: {
    maxStops: 7,
    minProgressKm: 4,
    detourSpeedKmh: 50,
    socTolerancePct: 1e-4,
    belowSafetyFloorPct: 2,
    socGridPct: 1,
    occupiedWaitMin: sourced(15, "estimated", { notes: "Sin datos de ocupación; calibrar." }),
    maxVerifyIterations: 3,
  },
  speed: {
    meshSpacingM: 100,
    curvatureSpanM: 100,
    defaultByRoadTier: sourced(
      { primary: 90, secondary: 80, tertiary: 60, local: 50, unpaved: 40 },
      "configurable",
      {
        reference: "docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md §3.1 (D8)",
        notes: "Decisión del producto; confirmar contra la normativa colombiana vigente.",
      },
    ),
    modes: sourced(
      {
        efficient: {
          targetSpeedFactor: 0.9,
          maxAccelMs2: 0.8,
          maxDecelMs2: 0.8,
          maxLateralAccelMs2: 1.5,
        },
        normal: { targetSpeedFactor: 1, maxAccelMs2: 1.2, maxDecelMs2: 1.5, maxLateralAccelMs2: 2 },
        sport: { targetSpeedFactor: 1.08, maxAccelMs2: 2, maxDecelMs2: 2.5, maxLateralAccelMs2: 3 },
      },
      "estimated",
      {
        reference: "docs/arquitectura-ev/prompt_ev_route_engine_v2.md §5.3",
        notes:
          "sport: +8 % sobre la velocidad típica, tope en el límite legal (sin dato de congestión).",
      },
    ),
  },
  energy: {
    vehicleDefaults: {
      rotationalInertiaFactor: sourced(1.05, "estimated", {
        notes: "Típico 1,03–1,08 (especificación §3.3).",
      }),
      drivetrainEfficiency: sourced(0.9, "estimated", {
        notes: "Batería → rueda; el modelo anterior daba 0,90–0,925 según motorKw.",
      }),
      regenEfficiency: sourced(0.8, "estimated", { notes: "Rueda → batería." }),
      maxRegenPowerKw: sourced(60, "estimated", {
        notes: "Sin dato del fabricante; el modelo anterior usaba 40 % de motorKw.",
      }),
      baseAuxPowerKw: sourced(0.45, "estimated", { notes: "Mismo valor que el modelo anterior." }),
    },
    regenModes: sourced(
      {
        // captureFraction × regenEfficiency ≈ el recobro del modelo anterior (0,35 / 0,55 / 0,70).
        low: { captureFraction: 0.45, maxPowerFraction: 0.5 },
        medium: { captureFraction: 0.7, maxPowerFraction: 0.8 },
        high: { captureFraction: 0.88, maxPowerFraction: 1 },
      },
      "estimated",
      { notes: "Calibrar con viajes reales (TripObservation)." },
    ),
    manualReferenceSpeedKmh: 70,
    temperatureFactor: sourced(
      [
        [0, 1.28],
        [5, 1.16],
        [10, 1.07],
        [15, 1],
        [32, 1],
        [38, 1.03],
      ],
      "estimated",
      {
        reference: "docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md §3.1 (D4)",
        notes:
          "Lado frío igual al modelo anterior (batería, llantas y tren fríos). En calor casi plano: el aire acondicionado ya suma el enfriamiento en los auxiliares.",
      },
    ),
  },
  chart: {
    windows: [
      { upToKm: 50, windowKm: 1 },
      { upToKm: 200, windowKm: 2 },
      { upToKm: Infinity, windowKm: 5 },
    ],
  },
  planning: {
    energyMarginPercent: 0,
  },
};
