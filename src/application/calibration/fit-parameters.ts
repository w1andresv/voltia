/**
 * Calibración automática (guía 05 §5.8, paso 3): con los viajes en que el
 * usuario anotó "¿Con cuánto llegaste?", ajusta los parámetros físicos
 * `estimated` del vehículo para que la energía v2 prediga lo que se consumió.
 *
 * Se compara energía, no SOC con paradas: si los parámetros cambian, el
 * planificador elegiría otras paradas, pero el viaje real ya se hizo con las
 * del plan mostrado. Lo consumido sale de la caída de SOC observada más lo que
 * el plan cargaba en sus paradas (igual que `recordArrival`).
 *
 * Cada parámetro se ajusta como un factor sobre el valor que el vehículo ya
 * usa (el suyo o el por defecto), por búsqueda de sección dorada coordenada a
 * coordenada, con una penalización que lo acerca a 1: con pocos viajes el
 * resultado se queda cerca de lo actual. No escribe nada: propone valores.
 */
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";
import type { TripObservation } from "@/domain/ev/contracts/calibration";
import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import { energyProfileForRoute } from "@/domain/ev/energy-v2";
import { resolveVehicleEnergyParams } from "@/domain/ev/engines/energy/vehicle-params";
import { hasManualConsumption } from "@/domain/energy";
import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import type { RawRoute, TripConditions, Vehicle, WeatherSnapshot } from "@/domain/types";
import { planShown } from "./record-arrival";

/** Parámetros del vehículo que se pueden ajustar. */
export type CalibrationKnob =
  "drivetrainEfficiency" | "rollingResistance" | "dragAreaM2" | "baseAuxPowerKw";

export const DEFAULT_KNOBS: readonly CalibrationKnob[] = ["drivetrainEfficiency"];

/** Un viaje listo para calibrar: la ruta que se hizo y la energía que se consumió. */
export interface CalibrationCase {
  /** Id del viaje guardado (para el informe). */
  tripId: string;
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  raw: RawRoute;
  /** Energía de los desvíos a las paradas del plan, kWh (fija). */
  detourKwh: number;
  /** Energía consumida según el SOC observado y las cargas del plan, kWh. */
  observedKwh: number;
}

export type CaseSkip =
  "sin snapshot" | "sin plan" | "consumo manual" | "consumo observado no positivo";

/**
 * Arma el caso de un viaje guardado y su observación. Devuelve el motivo si no
 * sirve: sin snapshot no hay ruta; con consumo manual la energía se reescala al
 * dato del usuario y los parámetros físicos no cuentan.
 */
export function calibrationCase(
  trip: {
    id: string;
    request: PlanRequestShape;
    summary: TripSummaryShape;
    snapshot?: PlanningSnapshot;
  },
  observation: Pick<TripObservation, "observedSoc">,
): CalibrationCase | { skip: CaseSkip } {
  if (!trip.snapshot) return { skip: "sin snapshot" };
  const vehicle = trip.request.vehicle as Vehicle;
  if (hasManualConsumption(vehicle)) return { skip: "consumo manual" };
  const plan = planShown(trip.snapshot, trip.request, trip.summary);
  const raw =
    plan &&
    (trip.snapshot.verifiedRoutes?.[plan.id]?.route ??
      trip.snapshot.routes.find((r) => r.id === plan.id));
  if (!plan || !raw) return { skip: "sin plan" };
  const points = [...observation.observedSoc].sort((a, b) => a.distanceKm - b.distanceKm);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chargedPct = plan.stops.reduce((a, s) => a + (s.departSoc - s.arriveSoc), 0);
  const observedKwh =
    ((first.socPercent - last.socPercent + chargedPct) / 100) * vehicle.batteryKwh;
  if (!(observedKwh > 0)) return { skip: "consumo observado no positivo" };
  return {
    tripId: trip.id,
    vehicle,
    conditions: trip.request.conditions as TripConditions,
    weather: trip.snapshot.weather,
    raw,
    detourKwh: plan.stops.reduce((a, s) => a + (s.detourEnergyKwh ?? 0), 0),
    observedKwh,
  };
}

/** Valor que el vehículo usa hoy para `knob` (el suyo o el por defecto). */
function priorValue(c: CalibrationCase, knob: CalibrationKnob, params: ModelParameters): number {
  return resolveVehicleEnergyParams(c.vehicle, c.conditions, params)[knob].value;
}

/** Límites del valor ajustado, para no salir de lo físicamente creíble. */
const VALUE_BOUNDS: Record<CalibrationKnob, [number, number]> = {
  drivetrainEfficiency: [0.75, 0.97],
  rollingResistance: [0.006, 0.016],
  dragAreaM2: [0.4, 1.2],
  baseAuxPowerKw: [0, 2],
};

/** Energía que predice la v2 con cada parámetro multiplicado por su factor. */
export function predictedKwh(
  c: CalibrationCase,
  scales: Partial<Record<CalibrationKnob, number>>,
  params: ModelParameters = MODEL_PARAMETERS,
): number {
  const vehicle: Vehicle = { ...c.vehicle };
  for (const [knob, s] of Object.entries(scales) as [CalibrationKnob, number][]) {
    const [lo, hi] = VALUE_BOUNDS[knob];
    vehicle[knob] = Math.min(hi, Math.max(lo, priorValue(c, knob, params) * s));
  }
  const profile = energyProfileForRoute(c.raw, vehicle, c.conditions, c.weather, params);
  const last = profile.samples[profile.samples.length - 1];
  return (last?.cumulativeKwh ?? 0) + c.detourKwh;
}

export interface ErrorSummary {
  /** Media de (predicho − observado) / observado: positivo = el modelo sobreestima. */
  meanRelError: number;
  meanAbsRelError: number;
}

export interface FitResult {
  cases: number;
  knobs: {
    knob: CalibrationKnob;
    /** Factor sobre el valor actual (1 = sin cambio). */
    scale: number;
    /** Valor actual y ajustado del primer vehículo del grupo (referencia). */
    prior: number;
    fitted: number;
  }[];
  before: ErrorSummary;
  after: ErrorSummary;
  perCase: { tripId: string; observedKwh: number; beforeKwh: number; afterKwh: number }[];
}

export interface FitOptions {
  knobs?: readonly CalibrationKnob[];
  params?: ModelParameters;
  /** Peso de la penalización (factor − 1)²; más alto, más cerca de lo actual. */
  priorWeight?: number;
  /** Rango del factor que se busca. */
  scaleRange?: [number, number];
  /** Pasadas de la búsqueda coordenada. */
  rounds?: number;
}

function summarize(pairs: { observed: number; predicted: number }[]): ErrorSummary {
  const rel = pairs.map((p) => (p.predicted - p.observed) / p.observed);
  const n = Math.max(rel.length, 1);
  return {
    meanRelError: rel.reduce((a, b) => a + b, 0) / n,
    meanAbsRelError: rel.reduce((a, b) => a + Math.abs(b), 0) / n,
  };
}

/** Mínimo de `f` en [a, b] por sección dorada (f unimodal en el intervalo). */
function goldenMin(f: (x: number) => number, a: number, b: number, tol = 1e-4): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Ajusta los factores de `knobs` para el conjunto de viajes (un vehículo o
 * todos). Minimiza Σ ((predicho − observado) / observado)² + peso · Σ (factor − 1)².
 */
export function fitParameters(cases: CalibrationCase[], options: FitOptions = {}): FitResult {
  const params = options.params ?? MODEL_PARAMETERS;
  const knobs = options.knobs ?? DEFAULT_KNOBS;
  const weight = options.priorWeight ?? 0.02;
  const [lo, hi] = options.scaleRange ?? [0.8, 1.2];
  const scales: Record<string, number> = Object.fromEntries(knobs.map((k) => [k, 1]));

  const objective = (s: Record<string, number>) =>
    cases.reduce((a, c) => {
      const e = (predictedKwh(c, s, params) - c.observedKwh) / c.observedKwh;
      return a + e * e;
    }, 0) + knobs.reduce((a, k) => a + weight * (s[k]! - 1) ** 2, 0);

  if (cases.length) {
    for (let round = 0; round < (options.rounds ?? 3); round++) {
      for (const k of knobs) {
        scales[k] = goldenMin((x) => objective({ ...scales, [k]: x }), lo, hi);
      }
    }
  }

  const perCase = cases.map((c) => ({
    tripId: c.tripId,
    observedKwh: c.observedKwh,
    beforeKwh: predictedKwh(c, {}, params),
    afterKwh: predictedKwh(c, scales, params),
  }));
  const ref = cases[0];
  return {
    cases: cases.length,
    knobs: knobs.map((knob) => {
      const scale = scales[knob]!;
      const prior = ref ? priorValue(ref, knob, params) : Number.NaN;
      const [vlo, vhi] = VALUE_BOUNDS[knob];
      return { knob, scale, prior, fitted: Math.min(vhi, Math.max(vlo, prior * scale)) };
    }),
    before: summarize(perCase.map((p) => ({ observed: p.observedKwh, predicted: p.beforeKwh }))),
    after: summarize(perCase.map((p) => ({ observed: p.observedKwh, predicted: p.afterKwh }))),
    perCase,
  };
}
