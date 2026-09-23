import type { UserDataRepository } from "@/domain/user/ports";
import { deleteTripFn, listMyTripsFn, saveTripFn } from "@/server/actions/trips";
import { deleteVehicleFn, listMyVehiclesFn, saveVehicleFn } from "@/server/actions/vehicles";

/** Adaptador del usuario con sesión: server actions (RLS sobre el id interno). */
export function createRemoteRepository(): UserDataRepository {
  return {
    listVehicles: () => listMyVehiclesFn(),
    saveVehicle: (v) => saveVehicleFn({ data: v }),
    deleteVehicle: (id) => deleteVehicleFn({ data: { id } }),
    listTrips: () => listMyTripsFn(),
    saveTrip: (t) => saveTripFn({ data: t }),
    deleteTrip: (id) => deleteTripFn({ data: { id } }),
  };
}
