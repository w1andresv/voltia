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
    /**
     * Teselas de terreno de Mapbox: zoom, tileset y si se piden @2x (512 px). Zoom 11
     * con @2x da la misma resolución que zoom 12 de 256 px (≈ 38 m por píxel en el
     * ecuador) con cerca de la mitad de teselas, que son las consultas que se cobran.
     */
    terrain: { zoom: number; tileset: string; retina: boolean };
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
    /** DETOUR_SOURCE=matrix: estaciones compatibles que se miden por ruta, las más cercanas (cuida el cupo). */
    maxMatrixStationsPerRoute: number;
    /** A menos de esta distancia de la ruta el desvío es despreciable y no se mide. */
    minLateralKmToMeasure: number;
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
    /**
     * Piso de SOC en ruta con "permitir bajar del margen" (ADR-0017). También es
     * lo más bajo a que llega el margen flexible del v2 (ADR-0019).
     */
    belowSafetyFloorPct: number;
    /**
     * Planificador v2 (ADR-0019): el margen de seguridad no es estricto. El plan
     * puede bajar hasta `belowPct` puntos de él, en ruta y al destino, nunca por
     * debajo de `belowSafetyFloorPct`. Ese plan se usa solo si es claramente
     * mejor que el que respeta el margen: hace posible el viaje, evita la carga
     * antes de salir, tiene menos paradas o, con las mismas, ahorra al menos
     * `minSavingMin`. Al buscarlo, cada punto bajo el margen en el punto más bajo
     * de un tramo cuesta `penaltyMinPerPct` minutos (así baja lo menos posible).
     */
    marginFlex: SourcedValue<{ belowPct: number; penaltyMinPerPct: number; minSavingMin: number }>;
    /**
     * Tope de carga en ruta: ninguna parada carga por encima de este SOC. Antes
     * era `maxSocTravel` de cada vehículo; desde 2026-09-30 es uno solo (ADR-0016).
     */
    maxChargeTargetSocPct: SourcedValue<number>;
    /**
     * Planificador v2 (ADR-0018): si se para, se carga al menos estos minutos
     * (sin contar los de conexión), o hasta el tope. Una parada para cargar 1 %
     * no vale la pena: parquear, bajarse, abrir la app y conectar ya cuesta tiempo.
     */
    minChargeSessionMin: SourcedValue<number>;
    /**
     * Planificador v2 (ADR-0018): una parada puede cargar por encima del tope en
     * ruta, hasta este SOC, solo si así el plan tiene menos paradas.
     */
    stretchChargeSocPct: SourcedValue<number>;
    /** Planificador v2: resolución del SOC de salida, en puntos. */
    socGridPct: number;
    /** Planificador v2: minutos de espera supuestos en una estación reportada ocupada. */
    occupiedWaitMin: SourcedValue<number>;
    /** Pasada 2: rutas reales que se piden como máximo para verificar un plan (especificación §4). */
    maxVerifyIterations: number;
    /**
     * Pasada 2: tiempo máximo al planificar (rutas más su elevación), ms. Al agotarse se
     * responde con la pasada 1, marcada `failed`, igual que al compartir un viaje (ADR-0020).
     */
    verifyBudgetMs: number;
    /**
     * Planificador v2: en una estación de carga rápida (DC) se carga `extraPct`
     * puntos más de lo que pide el tramo siguiente, sin pasar de `maxSocPct`
     * (del 90 al 100 % la carga se vuelve lenta) ni del tope de carga en ruta.
     */
    fastChargeBuffer: SourcedValue<{ extraPct: number; maxSocPct: number }>;
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
    // Medido 2026-09-27 (Bucaramanga → Bogotá): 23 teselas en vez de 49, alturas a 1,5 m en
    // promedio de zoom 12 y −0,1 kWh (docs/arquitectura-ev/mediciones/terreno-dem-2026-09-27.md).
    terrain: { zoom: 11, tileset: "mapbox.terrain-rgb", retina: true },
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
    maxMatrixStationsPerRoute: 24,
    minLateralKmToMeasure: 0.05,
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
    // Decisión del dueño del producto (2026-09-30, ADR-0017): era 2 %.
    belowSafetyFloorPct: 5,
    marginFlex: sourced({ belowPct: 3, penaltyMinPerPct: 4, minSavingMin: 10 }, "configurable", {
      notes:
        "Decisión del dueño del producto (2026-10-01, ADR-0019): el margen puede variar unos puntos siempre que no se quede sin batería. Se baja del margen para evitar una parada o la carga previa, o para ahorrar al menos 10 min; no por un par de minutos de carga.",
    }),
    maxChargeTargetSocPct: sourced(80, "configurable", {
      notes:
        "Decisión del dueño del producto (2026-09-30): el vehículo ya no define mínimo ni tope; la reserva es el margen del viaje y el tope es este (ADR-0016).",
    }),
    minChargeSessionMin: sourced(10, "configurable", {
      notes:
        "Decisión del dueño del producto (2026-09-30, ADR-0018): una parada vale la pena si se carga al menos 10 min; los 5 min de conexión aparte.",
    }),
    stretchChargeSocPct: sourced(90, "configurable", {
      notes:
        "Decisión del dueño del producto (2026-09-30, ADR-0018): pasar del tope de 80 % hasta 90 % solo para ahorrar una parada. Del 90 al 100 % la carga se vuelve lenta.",
    }),
    socGridPct: 1,
    occupiedWaitMin: sourced(15, "estimated", { notes: "Sin datos de ocupación; calibrar." }),
    maxVerifyIterations: 3,
    verifyBudgetMs: 8000,
    fastChargeBuffer: sourced({ extraPct: 10, maxSocPct: 90 }, "configurable", {
      notes:
        "Decisión del dueño del producto (2026-09-27): aprovechar la velocidad de la carga rápida para evitar paradas largas en carga lenta. Desde 2026-09-29 solo en tramos que terminan en otra estación, no al destino.",
    }),
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
