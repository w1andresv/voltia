import type { TripConditions, Vehicle } from "@/domain/types";
import { tripMassKg } from "@/domain/types";
import { MODEL_PARAMETERS, type ModelParameters } from "@/domain/ev/core/params";
import { sourced, type SourcedValue } from "@/domain/ev/core/provenance";

/**
 * Parámetros físicos con que se calcula la energía de un viaje (especificación
 * §3.3), cada uno con su fuente. Lo que el vehículo trae se marca
 * `configurable` (lo cargó el catálogo o el usuario); lo que falta sale de
 * ModelParameters y se marca `estimated`. La potencia del motor NO se usa.
 */
export interface VehicleEnergyParams {
  massKg: SourcedValue<number>;
  dragAreaM2: SourcedValue<number>;
  rollingResistance: SourcedValue<number>;
  rotationalInertiaFactor: SourcedValue<number>;
  drivetrainEfficiency: SourcedValue<number>;
  regenEfficiency: SourcedValue<number>;
  maxRegenPowerKw: SourcedValue<number>;
  baseAuxPowerKw: SourcedValue<number>;
}

function fromVehicle(
  value: number | undefined,
  fallback: SourcedValue<number>,
): SourcedValue<number> {
  return value != null ? sourced(value, "configurable") : fallback;
}

export function resolveVehicleEnergyParams(
  vehicle: Vehicle,
  conditions: TripConditions,
  params: ModelParameters = MODEL_PARAMETERS,
): VehicleEnergyParams {
  const body =
    params.vehicle.bodyTypePhysics.value[vehicle.bodyType ?? params.vehicle.defaultBodyType];
  const bodyRef = {
    reference: params.vehicle.bodyTypePhysics.reference,
    notes: "Valor por carrocería.",
  };
  const d = params.energy.vehicleDefaults;
  return {
    massKg: sourced(tripMassKg(vehicle, conditions), "calculated", {
      notes: "Peso del vehículo + pasajeros + equipaje.",
    }),
    dragAreaM2: fromVehicle(vehicle.dragAreaM2, sourced(body.dragAreaM2, "estimated", bodyRef)),
    rollingResistance: fromVehicle(
      vehicle.rollingResistance,
      sourced(body.rollingResistance, "estimated", bodyRef),
    ),
    rotationalInertiaFactor: fromVehicle(
      vehicle.rotationalInertiaFactor,
      d.rotationalInertiaFactor,
    ),
    drivetrainEfficiency: fromVehicle(vehicle.drivetrainEfficiency, d.drivetrainEfficiency),
    regenEfficiency: fromVehicle(vehicle.regenEfficiency, d.regenEfficiency),
    maxRegenPowerKw: fromVehicle(vehicle.maxRegenPowerKw, d.maxRegenPowerKw),
    baseAuxPowerKw: fromVehicle(vehicle.baseAuxPowerKw, d.baseAuxPowerKw),
  };
}

/** Nombres de los parámetros estimados (van a los supuestos del plan). */
export function estimatedParams(p: VehicleEnergyParams): (keyof VehicleEnergyParams)[] {
  return (Object.keys(p) as (keyof VehicleEnergyParams)[]).filter(
    (k) => p[k].source === "estimated",
  );
}
