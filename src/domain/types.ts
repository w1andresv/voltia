import type { VehicleShape, PlaceShape, TripConditionsShape } from "@/domain/schemas";

export type ConnectorType = "ccs2" | "ccs1" | "type2" | "chademo" | "nacs" | "gb_t";

export type DrivingStyle = "efficient" | "normal" | "sport";
export type ClimateControl = "off" | "eco" | "normal" | "max";
export type SafetyMode = "conservative" | "normal" | "low" | "custom";
export type PlanningMode = "fastest" | "efficient" | "fewer_stops" | "safer" | "custom";
export type EnergyMode = "manual" | "estimated";
export type ChargerSource = "osm" | "catalog" | "community" | "plugshare";
export type StationStatus = "pending" | "approved" | "rejected";
export type StationAvailability = "unknown" | "available" | "occupied" | "offline";

export interface ChargeCurvePoint {
  soc: number;
  powerFactor: number;
}

/**
 * Vehicle/Place/TripConditions se derivan del esquema Zod en
 * @/domain/schemas — esa es la fuente de verdad; no repetir sus campos aquí.
 */
export type Vehicle = VehicleShape;
export type Place = PlaceShape;
export type TripConditions = TripConditionsShape;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteSample {
  km: number;
  lat: number;
  lon: number;
  elevM: number;
  slopePct: number;
  speedKmh: number;
  energyKwh: number;
  energyGrossKwh: number;
  energyRegenKwh: number;
  cumulativeKwh: number;
  avgKwhPer100: number;
  soc: number;
}

export interface ChargerSocket {
  connector: ConnectorType;
  powerKw: number;
  count: number;
}

export interface Charger {
  id: string;
  name: string;
  lat: number;
  lon: number;
  operator?: string;
  sockets: ChargerSocket[];
  access?: string;
  openingHours?: string;
  pricePerKwh?: { amount: number; currency: string };
  source: ChargerSource;
  available?: boolean | null;
  availability?: StationAvailability;
  status?: StationStatus;
  address?: string;
  notes?: string;
  photos?: string[];
  reviewNote?: string;
  url?: string;
  /** Explicit operator/OSM confirmation. Catalog entries without this are ignored. */
  verified?: boolean;
  /** ISO date or datetime of the last known source update. */
  updatedAt?: string;
  detourKm?: number;
  nearestKm?: number;
  nearestSampleIndex?: number;
  fromRouteKm?: number;
}

export interface ChargeStop {
  charger: Charger;
  arriveSoc: number;
  departSoc: number;
  chargeMinutes: number;
  energyAddedKwh: number;
  bestSocket: ChargerSocket;
  kmAlongRoute: number;
  fromRouteKm: number;
  detourKm: number;
  detourMinutes: number;
  chargeKw: number;
  kmToNext: number;
  nextLabel: string;
}

export interface ElevationStats {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
}

export interface WeatherSnapshot {
  temperatureC: number;
  windKmh: number;
  windDirDeg: number;
  source?: string;
}

export interface RawRoute {
  id: string;
  label: string;
  geometry: LatLon[];
  samples: Omit<RouteSample, "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc">[];
  distanceKm: number;
  driveMinutes: number;
  elevation: ElevationStats;
  /** Vías principales ("Ruta 45A, Ruta 66"), si el motor las informa. */
  via?: string;
  /** La ruta evita peajes (pedida con exclude=toll o idéntica a esa). */
  noTolls?: boolean;
}

export interface ItineraryNode {
  kind: "origin" | "destination" | "charger" | "via";
  label: string;
  km: number;
  soc: number;
  durationFromStartMin: number;
  place?: Place;
  charge?: ChargeStop;
}

export interface RoutePlan {
  id: string;
  label: string;
  via?: string;
  noTolls?: boolean;
  geometry: LatLon[];
  samples: RouteSample[];
  /** Distancia de la ruta, sin desvíos a cargadores. */
  distanceKm: number;
  /** Km extra (ida y vuelta) para llegar a los cargadores fuera de la vía. */
  detourKm: number;
  driveMinutes: number;
  chargeMinutes: number;
  totalMinutes: number;
  energyKwh: number;
  energyGrossKwh: number;
  energyRegenKwh: number;
  avgKwhPer100km: number;
  energyMode: EnergyMode;
  arrivalSoc: number;
  initialSoc: number;
  remainingKwh: number;
  minSoc: number;
  safetyPct: number;
  safetyMarginPct: number;
  canArriveWithoutCharge: boolean;
  feasible: boolean;
  infeasibleReason?: string;
  stops: ChargeStop[];
  itinerary: ItineraryNode[];
  elevation: ElevationStats;
  weather: WeatherSnapshot | null;
}

export interface GeoBundle {
  routes: RawRoute[];
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  warnings: string[];
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
  waypoints: Place[];
  vehicle: Vehicle;
  conditions: TripConditions;
}

export interface PlanResponse {
  geo: GeoBundle;
  plans: RoutePlan[];
  selectedId: string;
}

export const CONNECTOR_LABEL: Record<ConnectorType, string> = {
  ccs2: "CCS2",
  ccs1: "CCS1",
  type2: "Tipo 2",
  chademo: "CHAdeMO",
  nacs: "NACS",
  gb_t: "GB/T",
};

export const CHARGER_SOURCE_LABEL: Record<ChargerSource, string> = {
  osm: "OpenStreetMap",
  catalog: "Catálogo del operador",
  community: "Comunidad",
  plugshare: "PlugShare",
};

export const STATION_STATUS_LABEL: Record<StationStatus, string> = {
  pending: "Pendiente de validación",
  approved: "Confirmada",
  rejected: "Rechazada",
};

export const STATION_AVAIL_LABEL: Record<StationAvailability, string> = {
  unknown: "Sin dato",
  available: "Disponible",
  occupied: "Ocupada",
  offline: "Fuera de servicio",
};

export const DEFAULT_CONDITIONS: TripConditions = {
  passengers: 0,
  luggageKg: 20,
  initialSoc: 82,
  arrivalSoc: 20,
  avgSpeedKmh: null,
  ac: "normal",
  temperatureC: null,
  drivingStyle: "normal",
  safetyMode: "normal",
  customSafetyPct: 15,
  planningMode: "fastest",
  allowBelowSafety: false,
  regenPct: 20,
};

export const DRIVER_KG = 75;
export const PERSON_KG = 75;

/** Shown when the trip needs a charge and no verified station is in remaining range. */
export const NO_VERIFIED_STOP_REASON =
  "No se encontró una electrolinera verificada dentro de la autonomía disponible. No es posible generar una estrategia de recarga segura para este tramo.";

export function hasValidCoords(c: { lat: number; lon: number }): boolean {
  return (
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lon) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lon) <= 180 &&
    !(c.lat === 0 && c.lon === 0)
  );
}

/**
 * Charge-stop planner gate. Never invent a pin: only OSM, PlugShare,
 * community-approved, and catalog rows explicitly marked verified.
 */
export function isVerifiedForPlanning(c: Charger): boolean {
  if (!hasValidCoords(c)) return false;
  if (!c.name?.trim()) return false;
  if (c.access === "private") return false;
  if (c.status === "rejected" || c.status === "pending") return false;
  if (c.source === "community") return c.status === "approved";
  if (c.source === "osm" || c.source === "plugshare") return true;
  if (c.source === "catalog") return c.verified === true;
  return false;
}

/** Occupants besides the driver, plus luggage. Driver mass is always included. */
export function extraWeightKg(c: TripConditions): number {
  return DRIVER_KG + Math.max(0, c.passengers) * PERSON_KG + Math.max(0, c.luggageKg);
}

export function tripMassKg(vehicle: Vehicle, c: TripConditions): number {
  return vehicle.weightKg + extraWeightKg(c);
}

export function safetyPct(c: TripConditions): number {
  if (c.safetyMode === "conservative") return 20;
  if (c.safetyMode === "low") return 10;
  if (c.safetyMode === "custom") return c.customSafetyPct;
  return 15;
}
