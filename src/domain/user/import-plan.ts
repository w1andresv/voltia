import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import type { Vehicle } from "@/domain/types";
import { vehicleFingerprint, tripFingerprint } from "./fingerprint";
import { differsFromCatalog } from "./catalog-rules";

export interface GuestTripInput {
  clientId: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
}

export interface AccountSnapshot {
  vehicles: Vehicle[];
  /** Rutas de la cuenta: `clientId` solo si vino de una importación previa. */
  trips: { clientId: string | null; request: PlanRequestShape }[];
}

export type VehicleOutcome =
  | { localId: string; action: "insert"; payload: Vehicle }
  | {
      localId: string;
      action: "skip";
      reason: "catalog-unchanged" | "account-has-edit" | "equivalent-in-account";
    };

export type TripOutcome =
  | {
      clientId: string;
      action: "insert";
      payload: { request: PlanRequestShape; summary: TripSummaryShape };
    }
  | { clientId: string; action: "skip"; reason: "already-imported" | "duplicate" };

export interface ImportPlan {
  vehicles: VehicleOutcome[];
  trips: TripOutcome[];
  /** id local → id que vale en la cuenta (solo entradas donde cambia). */
  idMap: Record<string, string>;
  /** Ediciones locales de catálogo descartadas porque la cuenta ya tenía una. */
  discardedEdits: string[];
}

function freshVehicleId(base: string, taken: Set<string>): string {
  let i = 1;
  let id = `${base}-imp${i}`;
  while (taken.has(id)) {
    i += 1;
    id = `${base}-imp${i}`;
  }
  return id;
}

/**
 * Decide, sin I/O, qué se sube y qué se omite (los nueve casos de la tabla del
 * plan). El servidor aplica el resultado; el cliente usa `idMap` para remapear
 * el vehículo seleccionado.
 */
export function planImport(input: {
  guestVehicles: Vehicle[];
  guestTrips: GuestTripInput[];
  account: AccountSnapshot;
  catalog: readonly Vehicle[];
}): ImportPlan {
  const { guestVehicles, guestTrips, account, catalog } = input;
  const catalogIds = new Set(catalog.map((c) => c.id));
  const accountIds = new Set(account.vehicles.map((v) => v.id));
  const accountByFingerprint = new Map(account.vehicles.map((v) => [vehicleFingerprint(v), v]));

  const idMap: Record<string, string> = {};
  const discardedEdits: string[] = [];
  const vehicles: VehicleOutcome[] = [];
  const taken = new Set<string>([...catalogIds, ...accountIds]);

  for (const v of guestVehicles) {
    if (catalogIds.has(v.id)) {
      // Vehículo de catálogo: sin cambios no se sube; una edición gana la cuenta si ya tiene una.
      if (!differsFromCatalog(v, catalog)) {
        vehicles.push({ localId: v.id, action: "skip", reason: "catalog-unchanged" });
      } else if (accountIds.has(v.id)) {
        vehicles.push({ localId: v.id, action: "skip", reason: "account-has-edit" });
        discardedEdits.push(v.id);
      } else {
        vehicles.push({ localId: v.id, action: "insert", payload: v });
        accountIds.add(v.id);
      }
      continue;
    }

    // Personalizado: misma huella que uno de la cuenta → se mapea, no se duplica.
    const equivalent = accountByFingerprint.get(vehicleFingerprint(v));
    if (equivalent) {
      if (equivalent.id !== v.id) idMap[v.id] = equivalent.id;
      vehicles.push({ localId: v.id, action: "skip", reason: "equivalent-in-account" });
      continue;
    }

    // Sin equivalente: se inserta; si el id local choca con otro distinto, recibe id nuevo.
    let payload = v;
    if (accountIds.has(v.id)) {
      const id = freshVehicleId(v.id, taken);
      idMap[v.id] = id;
      payload = { ...v, id };
    }
    taken.add(payload.id);
    accountIds.add(payload.id);
    accountByFingerprint.set(vehicleFingerprint(payload), payload);
    vehicles.push({ localId: payload.id, action: "insert", payload });
  }

  const importedClientIds = new Set(
    account.trips.map((t) => t.clientId).filter((c): c is string => Boolean(c)),
  );
  const accountTripFingerprints = new Set(account.trips.map((t) => tripFingerprint(t.request)));
  const trips: TripOutcome[] = [];

  for (const t of guestTrips) {
    if (importedClientIds.has(t.clientId)) {
      trips.push({ clientId: t.clientId, action: "skip", reason: "already-imported" });
      continue;
    }
    // La ruta embebe el vehículo: se remapea con el id final.
    const mapped = idMap[t.request.vehicle.id];
    const request: PlanRequestShape = mapped
      ? { ...t.request, vehicle: { ...t.request.vehicle, id: mapped } }
      : t.request;
    const fp = tripFingerprint(request);
    if (accountTripFingerprints.has(fp)) {
      trips.push({ clientId: t.clientId, action: "skip", reason: "duplicate" });
      continue;
    }
    accountTripFingerprints.add(fp);
    trips.push({
      clientId: t.clientId,
      action: "insert",
      payload: { request, summary: t.summary },
    });
  }

  return { vehicles, trips, idMap, discardedEdits };
}
