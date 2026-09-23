import type { Vehicle } from "./types";
import { DEFAULT_CURVE } from "./charging";

/**
 * Respaldo mínimo: solo el vehículo por defecto, por si la base no responde.
 * El catálogo real (con la fuente de cada cifra) está en
 * seeds/0001_vehicle_catalog.sql y se lee de la base (listCatalogVehiclesFn).
 * Sus valores deben coincidir con esa fila del seed (lo comprueba seeds.test.ts).
 */
export const VEHICLE_CATALOG: Vehicle[] = [
  {
    id: "mg-s5-ev-comfort",
    brand: "MG",
    model: "S5 EV",
    year: 2027,
    version: "Comfort",
    batteryKwh: 47.1,
    rangeKm: 340,
    weightKg: 1627,
    motorKw: 125,
    acMaxKw: 7,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 15,
    maxSocTravel: 80,
    consumptionKwhPer100km: null,
    consumptionManual: false,
  },
];

export const DEFAULT_VEHICLE_ID = "mg-s5-ev-comfort";

export function vehicleLabel(vehicle: Vehicle): string {
  return `${vehicle.brand} ${vehicle.model}`;
}

export function vehicleSub(vehicle: Vehicle): string {
  return `${vehicle.year} · ${vehicle.version}`;
}

export function catalogById(id: string): Vehicle | undefined {
  return VEHICLE_CATALOG.find((v) => v.id === id);
}

export function isCatalogId(id: string): boolean {
  return VEHICLE_CATALOG.some((v) => v.id === id);
}

export function isVehicleModified(vehicle: Vehicle): boolean {
  const factory = catalogById(vehicle.id);
  if (!factory) return false;
  return (
    vehicle.brand !== factory.brand ||
    vehicle.model !== factory.model ||
    vehicle.year !== factory.year ||
    vehicle.version !== factory.version ||
    vehicle.batteryKwh !== factory.batteryKwh ||
    vehicle.rangeKm !== factory.rangeKm ||
    vehicle.weightKg !== factory.weightKg ||
    vehicle.motorKw !== factory.motorKw ||
    vehicle.acMaxKw !== factory.acMaxKw ||
    vehicle.dcMaxKw !== factory.dcMaxKw ||
    vehicle.minSocRecommended !== factory.minSocRecommended ||
    vehicle.maxSocTravel !== factory.maxSocTravel ||
    vehicle.connectors.join() !== factory.connectors.join() ||
    Boolean(vehicle.consumptionManual) !== Boolean(factory.consumptionManual) ||
    (vehicle.consumptionKwhPer100km ?? null) !== (factory.consumptionKwhPer100km ?? null)
  );
}

export function emptyCustomVehicle(): Vehicle {
  return {
    id: `custom-${Date.now()}`,
    brand: "",
    model: "",
    year: new Date().getFullYear(),
    version: "Personalizado",
    batteryKwh: 64,
    rangeKm: 400,
    weightKg: 1750,
    motorKw: 150,
    acMaxKw: 11,
    dcMaxKw: 120,
    chargeCurve: DEFAULT_CURVE,
    connectors: ["ccs2", "type2"],
    minSocRecommended: 15,
    maxSocTravel: 80,
    isCustom: true,
    consumptionKwhPer100km: null,
    consumptionManual: false,
  };
}

