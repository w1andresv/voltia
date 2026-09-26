import type { BodyType } from "../../types";
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
    bodyTypePhysics: SourcedValue<Record<BodyType, { dragAreaM2: number; rollingResistance: number }>>;
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
    /** Minutos fijos por parada (conectar, autorizar). 0 hasta calibrar. */
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
  },
  soc: {
    regenAcceptance: { fullBelowPct: 80, zeroFromPct: 98 },
  },
  corridor: {
    maxFromRouteKm: 12,
    preferredFromRouteKm: 5,
    detourRoadFactor: sourced(1, "estimated", { notes: "Línea recta ida y vuelta; se reemplaza con la matriz de rutas." }),
  },
  charging: {
    connectionOverheadMin: sourced(0, "configurable", { notes: "Sin dato medido; calibrar con paradas reales." }),
    integrationStepPct: 0.5,
  },
  planner: {
    maxStops: 7,
    minProgressKm: 4,
    detourSpeedKmh: 50,
    socTolerancePct: 1e-4,
    belowSafetyFloorPct: 2,
  },
  planning: {
    energyMarginPercent: 0,
  },
};
