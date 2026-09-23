import type { NewTrip, SavedTrip, Vehicle } from "./types";

/** Vehículos y rutas del usuario; el adaptador (navegador o servidor) lo decide el contexto. */
export interface UserDataRepository {
  /** Solo propios: personalizados o ediciones de un vehículo de catálogo. */
  listVehicles(): Promise<Vehicle[]>;
  saveVehicle(v: Vehicle): Promise<Vehicle>;
  deleteVehicle(id: string): Promise<void>;
  listTrips(): Promise<SavedTrip[]>;
  saveTrip(t: NewTrip): Promise<SavedTrip>;
  deleteTrip(id: string): Promise<void>;
}

export interface Identity {
  provider: string;
  subject: string;
  email: string;
}

/** Puerto de servidor: quién es el que llama según el proveedor de identidad. */
export interface IdentityProvider {
  currentIdentity(): Promise<Identity | null>;
}
