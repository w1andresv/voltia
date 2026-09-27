import type { RoadMix, RoadTier } from "./road-hierarchy";
import type { FeasibilityStatus, InfeasibilityReason } from "./ev/engines/feasibility/engine";
import type {
  VehicleShape,
  PlaceShape,
  TripConditionsShape,
  RegenLevelShape,
  BodyTypeShape,
} from "@/domain/schemas";

export type ConnectorType = "ccs2" | "ccs1" | "type2" | "chademo" | "nacs" | "gb_t";

export type DrivingStyle = "efficient" | "normal" | "sport";
export type ClimateControl = "off" | "eco" | "normal" | "max";
export type SafetyMode = "conservative" | "normal" | "low" | "custom";
export type RegenLevel = RegenLevelShape;
export type BodyType = BodyTypeShape;
export type PlanningMode = "fastest" | "efficient" | "fewer_stops" | "safer" | "custom";
export type EnergyMode = "manual" | "estimated";
export type ChargerSource = "osm" | "catalog" | "community" | "plugshare" | "siveeic" | "blaze";
export type StationStatus = "pending" | "approved" | "rejected";
export type StationAvailability = "unknown" | "available" | "occupied" | "offline";
export type RoutingEngine = "mapbox-traffic" | "mapbox" | "osrm";

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
  /** Límite legal del tramo que llega a esta muestra (el menor), si el proveedor lo informa (F5). */
  speedLimitKmh?: number;
  /** Clase vial predominante del tramo que llega a esta muestra, si el proveedor la informa (F5). */
  roadTier?: RoadTier;
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
  /** Tipo de corriente, si se conoce (F4). */
  current?: "AC" | "DC" | null;
  /** "reported": lo dice una fuente; "standard": se dedujo del estándar del conector. */
  currentOrigin?: "reported" | "standard" | null;
  /** "reported": potencia de una fuente; "assumed": valor por defecto del estándar (C7). */
  powerOrigin?: "reported" | "assumed" | null;
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
  /** Minutos de ida y vuelta al cargador cuando el desvío se midió por vía (F4). */
  detourMinutes?: number;
  /** "calculated": desvío medido con la matriz de distancias; "estimated": en línea recta. */
  detourSource?: "estimated" | "calculated";
  nearestKm?: number;
  nearestSampleIndex?: number;
  fromRouteKm?: number;
}

export interface ChargeChoice {
  mode: "direct" | "adapter" | "ac";
  socket: ChargerSocket;
  adapter?: { from: ConnectorType; to: ConnectorType };
  nominalKw: number;
  chargeKw: number;
  arriveSoc: number;
  minDepartSoc: number;
  departSoc: number;
  energyAddedKwh: number;
  chargeMinutes: number;
  rangeGainKm: number;
  reachesNext: boolean;
}

export interface ChargeAlternative {
  mode: "ac";
  socket: ChargerSocket;
  arriveSoc: number;
  minDepartSoc: number;
  departSoc: number;
  energyAddedKwh: number;
  chargeKw: number;
  chargeMinutes: number;
  rangeGainKm: number;
}

export interface AdapterNeeded {
  from: ConnectorType;
  to: ConnectorType;
  /** El usuario marcó que lo lleva: el plan ya lo usa. */
  carried: boolean;
  withAdapter: { chargeKw: number; chargeMinutes: number };
  /** La mejor opción sin adaptador en la misma estación; null si no hay otra toma compatible. */
  withoutAdapter: { mode: "direct" | "ac"; chargeKw: number; chargeMinutes: number } | null;
}

export interface ChargeStop {
  charger: Charger;
  arriveSoc: number;
  departSoc: number;
  /** Mínimo para llegar al siguiente punto o al destino, con el margen de seguridad. */
  minDepartSoc: number;
  chargeMinutes: number;
  energyAddedKwh: number;
  bestSocket: ChargerSocket;
  /** Presente cuando la opción elegida usa un adaptador de la lista verificada. */
  adapter?: { from: ConnectorType; to: ConnectorType };
  /**
   * La estación tiene carga rápida con un conector distinto al del vehículo:
   * qué adaptador hace falta, si el usuario lo lleva, y el tiempo de esta misma
   * carga (llegada → salida) con y sin él.
   */
  adapterNeeded?: AdapterNeeded;
  /** Carga lenta en la misma estación, cuando el plan usa otra opción. */
  alternative?: ChargeAlternative;
  /** Directo, cada adaptador definido y la carga lenta, si existen. */
  options?: ChargeChoice[];
  rangeGainKm: number;
  kmAlongRoute: number;
  fromRouteKm: number;
  detourKm: number;
  detourMinutes: number;
  /** De dónde sale el desvío: medido por vía o estimado en línea recta (F4). */
  detourSource?: "estimated" | "calculated";
  /** Energía del desvío (ida y vuelta) hasta el cargador, ya descontada en arriveSoc. */
  detourEnergyKwh?: number;
  chargeKw: number;
  kmToNext: number;
  nextLabel: string;
}

export interface ElevationStats {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
  /** Puntos de elevación corregidos (túneles, pendientes imposibles), si hubo (F2b). */
  correctedPoints?: number;
}

export interface WeatherSnapshot {
  temperatureC: number;
  windKmh: number;
  windDirDeg: number;
  /** Altura (m) de la celda del pronóstico: la temperatura se corrige desde ahí. */
  elevationM?: number;
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
  /** Km por nivel de la jerarquía vial (clasificación del proveedor); sin dato con OSRM. */
  roadMix?: RoadMix;
  /** Costo con jerarquía / tiempo real (≥ 1): cuánto "pesan" las vías menores de la ruta. */
  hierarchyFactor?: number;
  /** Dentro de la tolerancia (+15 % tiempo, +10 % km frente a la más rápida). */
  withinTolerance?: boolean;
  /** Km ponderados por vías menores fuera de los accesos (0 = todo por vías principales). */
  minorRoadScore?: number;
  /** Motor que calculó geometría y distancia. */
  engine?: RoutingEngine;
  /**
   * Km de cada punto intermedio (fin de cada tramo salvo el último), en el eje
   * de las muestras. Ahí el perfil de velocidad v2 se detiene (F5). Solo con
   * puntos intermedios.
   */
  legBoundariesKm?: number[];
  /** Túneles (km en el eje de las muestras): ahí la elevación se limpia (F2b). */
  structures?: { kind: "tunnel" | "bridge"; fromKm: number; toKm: number }[];
}

export interface DepartureCharge {
  /** SOC que el vehículo tiene ahora, antes de salir. */
  currentSoc: number;
  /** Puntos porcentuales extra, redondeados hacia arriba. */
  additionalPct: number;
  /** SOC de salida con el que se calcula el plan. */
  requiredStartSoc: number;
  chargerId: string;
  chargerName: string;
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
  roadMix?: RoadMix;
  hierarchyFactor?: number;
  withinTolerance?: boolean;
  minorRoadScore?: number;
  engine?: RoutingEngine;
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
  /** Regeneración que la batería aceptó (con el recorte por SOC alto). */
  energyRegenKwh: number;
  /** Regeneración potencial que la batería no aceptó por ir casi llena (F3). */
  regenCurtailedKwh?: number;
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
  /**
   * Recarga en el origen para llegar a la primera electrolinera verificada.
   * Solo cuando esa recarga cabe en el 100 %.
   */
  departureCharge?: DepartureCharge;
  /** Ni saliendo al 100 % se alcanza la primera electrolinera verificada. */
  firstChargerUnreachable?: boolean;
  /** Motor de planificación que armó el plan (PLANNER_ENGINE). */
  planner?: "legacy" | "v2";
  /** Modelo de energía (ENERGY_ENGINE, F5). */
  energyEngine?: "legacy" | "v2";
  /** Con el v2: parámetros físicos del vehículo que son valores por defecto (estimated). */
  energyAssumptions?: string[];
  /** Con el v2: tiempo de manejo del proveedor, para comparar con el del perfil de velocidad. */
  providerDriveMinutes?: number;
  /** Estado de viabilidad (solo planificador v2, especificación §5.9). */
  feasibilityStatus?: FeasibilityStatus;
  infeasibilityCode?: InfeasibilityReason;
  stops: ChargeStop[];
  itinerary: ItineraryNode[];
  elevation: ElevationStats;
  weather: WeatherSnapshot | null;
  /** Pasada 2 (F8): el plan recalculado sobre la ruta real que pasa por las paradas. */
  verification?: PlanVerification;
}

/**
 * Resultado de la pasada 2. `verified`: las paradas elegidas alcanzan sobre la
 * ruta real. `changed`: hubo que cambiar paradas y el cambio se verificó.
 * `failed`: no se pudo verificar (proveedor caído o sin convergencia); el plan
 * es el de la pasada 1, con desvíos estimados.
 */
export interface PlanVerification {
  status: "verified" | "changed" | "failed";
  /** Rutas pedidas al proveedor. */
  iterations: number;
  /** Km de la ruta de la pasada 1 (sin desvíos), para comparar con la real. */
  baseDistanceKm: number;
}

export const ELEVATION_UNAVAILABLE_TEXT =
  "No se pudo obtener la elevación de la ruta: el consumo se calculó como si fuera plana y puede estar muy subestimado en montaña. Vuelve a planificar en unos minutos.";

export const VERIFICATION_TEXT: Record<PlanVerification["status"], string> = {
  verified: "Verificado con la ruta real hasta cada parada.",
  changed: "Paradas ajustadas al recalcular con la ruta real hasta cada una.",
  failed: "No se pudo verificar con la ruta real: los desvíos a las paradas son estimados.",
};

export interface GeoBundle {
  routes: RawRoute[];
  chargers: Charger[];
  weather: WeatherSnapshot | null;
  warnings: string[];
  /** Versión del dataset consolidado de electrolineras usado para este plan. */
  stationsVersion?: string;
  /** Planificador con que respondió el servidor; el navegador recalcula con el mismo. */
  plannerEngine?: "legacy" | "v2";
  /** Modelo de energía con que respondió el servidor (F5); el navegador recalcula con el mismo. */
  energyEngine?: "legacy" | "v2";
  /** Desvíos medidos por vía, por `ruta|estación` (F4, DETOUR_SOURCE=matrix). */
  detours?: Record<string, { distanceKm: number; durationMin: number }>;
  /**
   * Calidad de los datos (solo si algo faltó, F2b). `elevation: "unavailable"`:
   * ninguna fuente de elevación respondió y alguna ruta quedó plana; es un error
   * de datos, no de viabilidad.
   */
  dataQuality?: { elevation?: "unavailable" };
}

export interface PlanRequest {
  origin: Place;
  destination: Place;
  waypoints: Place[];
  vehicle: Vehicle;
  conditions: TripConditions;
}

export interface PlanResponse {
  /** Un PlanningSnapshot (contracts/snapshot.ts) cuando viene del servidor. */
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
  siveeic: "SIVEEIC (MinEnergía)",
  blaze: "Blaze",
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

export const REGEN_LEVEL_LABEL: Record<RegenLevel, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export const ROUTING_ENGINE_LABEL: Record<RoutingEngine, string> = {
  "mapbox-traffic": "Mapbox (tráfico)",
  mapbox: "Mapbox",
  osrm: "OpenStreetMap (OSRM)",
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
  regenLevel: "medium",
};

export const DRIVER_KG = 75;
export const PERSON_KG = 75;

/** Shown when the trip needs a charge and no verified station is in remaining range. */
export const NO_VERIFIED_STOP_REASON =
  "No se encontró una electrolinera verificada dentro de la autonomía disponible. No es posible generar una estrategia de recarga segura para este tramo.";

/** Ni al 100 % de batería se llega a la primera electrolinera verificada. */
export const FIRST_CHARGER_UNREACHABLE_REASON =
  "No es posible realizar esta ruta con la autonomía disponible. El vehículo no puede alcanzar el primer punto de carga desde el punto de partida, incluso iniciando con el 100% de batería.";

/** Textos para cada motivo de no viabilidad del planificador v2. */
export const INFEASIBILITY_TEXT: Record<InfeasibilityReason, string> = {
  INITIAL_SOC_INSUFFICIENT: "Con la batería actual no alcanza: hay que cargar antes de salir.",
  GAP_BETWEEN_STATIONS_EXCEEDS_RANGE: NO_VERIFIED_STOP_REASON,
  NO_COMPATIBLE_STATIONS_IN_CORRIDOR:
    "No hay electrolineras verificadas y compatibles con el vehículo cerca de la ruta.",
  DESTINATION_RESERVE_UNREACHABLE:
    "Se llega al último tramo, pero no con la reserva pedida al destino. Baja la reserva o busca una ruta con más cargadores.",
  PLAN_VALIDATION_FAILED: "El plan calculado no pasó la verificación final. Intenta de nuevo o cambia las condiciones.",
};

export function departureChargeAdvice(additionalPct: number): string {
  const pct = Math.max(0, Math.round(additionalPct));
  return `Antes de iniciar la ruta debes cargar al menos un ${pct}% adicional para poder llegar al primer punto de carga.`;
}

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
  if (c.source === "osm" || c.source === "plugshare" || c.source === "siveeic") return true;
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
