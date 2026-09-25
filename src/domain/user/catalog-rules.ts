import type { Vehicle } from "@/domain/types";

/** Un vehículo propio con el mismo id que uno de catálogo es una edición de ese modelo. */
export function isCatalogEdit(vehicle: Vehicle, catalog: readonly Vehicle[]): boolean {
  return catalog.some((c) => c.id === vehicle.id);
}

/**
 * Catálogo + vehículos propios → lista completa que ve el usuario.
 * Las ediciones reemplazan al modelo de catálogo (conservando su id y el
 * consumo de fábrica si no se fijó a mano); el resto se agrega al final.
 */
export function mergeVehicles(
  catalog: readonly Vehicle[],
  own: readonly Vehicle[] | undefined,
): Vehicle[] {
  const ownList = own ?? [];
  const ownById = new Map(ownList.map((v) => [v.id, v]));
  const result: Vehicle[] = [];
  const seen = new Set<string>();

  for (const factory of catalog) {
    const edited = ownById.get(factory.id);
    result.push(
      edited
        ? {
            ...factory,
            ...edited,
            id: factory.id,
            consumptionKwhPer100km: edited.consumptionManual
              ? edited.consumptionKwhPer100km
              : factory.consumptionKwhPer100km,
            consumptionManual: Boolean(edited.consumptionManual),
          }
        : factory,
    );
    seen.add(factory.id);
  }
  for (const v of ownList) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    result.push({
      ...v,
      consumptionKwhPer100km: v.consumptionManual ? v.consumptionKwhPer100km : null,
      consumptionManual: Boolean(v.consumptionManual),
    });
  }
  return result;
}

const SAME_FIELDS = [
  "brand",
  "model",
  "year",
  "version",
  "batteryKwh",
  "rangeKm",
  "consumptionKwhPer100km",
  "consumptionManual",
  "weightKg",
  "motorKw",
  "acMaxKw",
  "dcMaxKw",
  "minSocRecommended",
  "maxSocTravel",
] as const;

/** ¿El vehículo difiere del de catálogo con su mismo id? Sin catálogo con ese id, es personalizado (true). */
export function differsFromCatalog(vehicle: Vehicle, catalog: readonly Vehicle[]): boolean {
  const factory = catalog.find((c) => c.id === vehicle.id);
  if (!factory) return true;
  const sameScalars = SAME_FIELDS.every((k) => (vehicle[k] ?? null) === (factory[k] ?? null));
  return (
    !sameScalars ||
    JSON.stringify(vehicle.connectors) !== JSON.stringify(factory.connectors) ||
    JSON.stringify(vehicle.adapters ?? []) !== JSON.stringify(factory.adapters ?? []) ||
    JSON.stringify(vehicle.chargeCurve) !== JSON.stringify(factory.chargeCurve)
  );
}

/** De la lista completa del navegador, deja solo lo que hay que persistir: personalizados y ediciones reales. */
export function extractOwnVehicles(
  all: readonly Vehicle[],
  catalog: readonly Vehicle[],
): Vehicle[] {
  return all.filter((v) => differsFromCatalog(v, catalog));
}
