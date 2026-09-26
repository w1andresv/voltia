/**
 * Fuente única de verdad para las formas de Vehicle/Place/TripConditions:
 * un esquema Zod por tipo, y el tipo TS se deriva con z.infer en
 * src/lib/domain/types.ts. Antes, src/lib/api/plan.ts repetía estas mismas
 * formas a mano (VehicleSchema/ConditionsSchema) — con el tiempo divergieron
 * del tipo real (VehicleSchema traía un `regenPct` que Vehicle nunca tuvo).
 * Cualquier validación de estos tres tipos —server actions incluidas—
 * importa los esquemas de aquí en vez de declarar los suyos.
 */
import { z } from "zod";

export const ConnectorTypeSchema = z.enum(["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"]);
export const ChargeAdapterSchema = z.object({
  from: ConnectorTypeSchema,
  to: ConnectorTypeSchema,
});
export const DrivingStyleSchema = z.enum(["efficient", "normal", "sport"]);
export const ClimateControlSchema = z.enum(["off", "eco", "normal", "max"]);
export const SafetyModeSchema = z.enum(["conservative", "normal", "low", "custom"]);
export const PlanningModeSchema = z.enum(["fastest", "efficient", "fewer_stops", "safer", "custom"]);
export const RegenLevelSchema = z.enum(["low", "medium", "high"]);
/** Carrocería: elige Cd·A y Crr por defecto cuando el vehículo no trae los suyos. */
export const BodyTypeSchema = z.enum(["sedan", "suv_compact", "suv_large"]);
export type BodyTypeShape = z.infer<typeof BodyTypeSchema>;
export type RegenLevelShape = z.infer<typeof RegenLevelSchema>;

export const ChargeCurvePointSchema = z.object({
  soc: z.number(),
  powerFactor: z.number(),
});

export const VehicleSchema = z.object({
  id: z.string(),
  brand: z.string(),
  model: z.string(),
  year: z.number(),
  version: z.string(),
  batteryKwh: z.number().positive(),
  rangeKm: z.number().positive(),
  consumptionKwhPer100km: z.number().positive().nullable(),
  consumptionManual: z.boolean().optional(),
  weightKg: z.number().positive(),
  motorKw: z.number().positive(),
  acMaxKw: z.number().positive(),
  dcMaxKw: z.number().positive(),
  chargeCurve: z.array(ChargeCurvePointSchema),
  connectors: z.array(ConnectorTypeSchema),
  adapters: z.array(ChargeAdapterSchema).optional(),
  minSocRecommended: z.number(),
  maxSocTravel: z.number(),
  isCustom: z.boolean().optional(),
  bodyType: BodyTypeSchema.optional(),
  /** Cd × área frontal (m²). Si falta, sale de la tabla por carrocería. */
  dragAreaM2: z.number().positive().optional(),
  /** Coeficiente de rodadura. Si falta, sale de la tabla por carrocería. */
  rollingResistance: z.number().positive().optional(),
});

export const PlaceSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  context: z.string().optional(),
});

export const TripConditionsSchema = z.object({
  passengers: z.number().min(0).max(8),
  luggageKg: z.number().min(0).max(400),
  initialSoc: z.number().min(1).max(100),
  arrivalSoc: z.number().min(0).max(80),
  avgSpeedKmh: z.number().nullable(),
  ac: ClimateControlSchema,
  temperatureC: z.number().nullable(),
  drivingStyle: DrivingStyleSchema,
  safetyMode: SafetyModeSchema,
  customSafetyPct: z.number().min(5).max(40),
  planningMode: PlanningModeSchema,
  allowBelowSafety: z.boolean(),
  regenLevel: RegenLevelSchema.default("medium"),
});

/**
 * Antes la regeneración era un porcentaje (`regenPct`, 5–80, por defecto 20).
 * Se traduce a nivel para leer viajes guardados y preferencias viejas.
 */
export function regenLevelFromLegacyPct(pct: unknown): RegenLevelShape {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "medium";
  if (pct <= 10) return "low";
  if (pct >= 50) return "high";
  return "medium";
}

/** Condiciones guardadas con `regenPct` → con `regenLevel`. Lo demás pasa igual. */
export function upgradeLegacyConditions(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { regenPct, ...rest } = value as Record<string, unknown>;
  if (RegenLevelSchema.safeParse(rest.regenLevel).success || regenPct === undefined) return rest;
  return { ...rest, regenLevel: regenLevelFromLegacyPct(regenPct) };
}

export type VehicleShape = z.infer<typeof VehicleSchema>;
export type PlaceShape = z.infer<typeof PlaceSchema>;
export type TripConditionsShape = z.infer<typeof TripConditionsSchema>;

/**
 * La misma petición de planificación que valida src/lib/api/plan.ts (sin
 * plugshareToken, que es de sesión y no se persiste) — fuente compartida
 * para guardar y para recalcular un viaje guardado o compartido (fase 4).
 */
export const PlanRequestSchema = z.object({
  origin: PlaceSchema,
  destination: PlaceSchema,
  waypoints: z.array(PlaceSchema).max(5),
  vehicle: VehicleSchema,
  conditions: z.preprocess(upgradeLegacyConditions, TripConditionsSchema),
});
export type PlanRequestShape = z.infer<typeof PlanRequestSchema>;

/**
 * Resumen liviano de un plan calculado, para mostrar en "Mis viajes" sin
 * tener que recalcular la ruta completa solo para listar el historial.
 */
export const TripSummarySchema = z.object({
  originLabel: z.string(),
  destinationLabel: z.string(),
  distanceKm: z.number(),
  totalMinutes: z.number(),
  stops: z.number().int().min(0),
  arrivalSoc: z.number(),
  energyKwh: z.number(),
});
export type TripSummaryShape = z.infer<typeof TripSummarySchema>;
