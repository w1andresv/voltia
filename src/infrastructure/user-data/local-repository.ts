import type { UserDataRepository } from "@/domain/user/ports";
import type { NewTrip, SavedTrip } from "@/domain/user/types";
import type { GuestStorage } from "./guest-storage";

/** Adaptador del invitado: vehículos y rutas en `voltia-guest` (localStorage). Nada llega al servidor. */
export function createLocalRepository(guest: GuestStorage): UserDataRepository {
  return {
    async listVehicles() {
      return guest.load().vehicles;
    },
    async saveVehicle(v) {
      guest.addVehicle(v);
      return v;
    },
    async deleteVehicle(id) {
      guest.removeVehicle(id);
    },
    async listTrips() {
      return guest
        .load()
        .trips.map<SavedTrip>((t) => ({
          id: t.clientId,
          request: t.request,
          summary: t.summary,
          shared: false,
          shareId: null,
          createdAt: t.createdAt,
        }))
        .reverse();
    },
    async saveTrip(t: NewTrip) {
      const data = guest.addTrip(t);
      const saved = data.trips.find((x) => x.clientId === t.clientId)!;
      return {
        id: saved.clientId,
        request: saved.request,
        summary: saved.summary,
        shared: false,
        shareId: null,
        createdAt: saved.createdAt,
      };
    },
    async deleteTrip(id) {
      guest.removeTrip(id);
    },
  };
}
