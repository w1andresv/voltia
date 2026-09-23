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
export const DrivingStyleSchema = z.enum(["efficient", "normal", "sport"]);
export const ClimateControlSchema = z.enum(["off", "eco", "normal", "max"]);
export const SafetyModeSchema = z.enum(["conservative", "normal", "low", "custom"]);
export const PlanningModeSchema = z.enum(["fastest", "efficient", "fewer_stops", "safer", "custom"]);

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
  minSocRecommended: z.number(),
  maxSocTravel: z.number(),
  isCustom: z.boolean().optional(),
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
  regenPct: z.number().min(5).max(80).optional().default(20),
});

export type VehicleShape = z.infer<typeof VehicleSchema>;
export type PlaceShape = z.infer<typeof PlaceSchema>;
export type TripConditionsShape = z.infer<typeof TripConditionsSchema>;
