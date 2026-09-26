import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
import type { PlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import type { Vehicle } from "@/domain/types";

/**
 * Contexto de usuario único: la UI habla con esto y no pregunta si es
 * invitado. `userId` es SIEMPRE el id interno de public.voltia_users, nunca el del
 * proveedor de identidad.
 */
export type UserContext =
  | { kind: "guest"; guestId: string }
  | { kind: "authenticated"; userId: string; email: string; role: "member" | "admin" };

export interface SavedTrip {
  id: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
  /** Datos con que se calculó (solo viajes de la cuenta, desde F8): abrirlo no vuelve a consultar proveedores. */
  snapshot?: PlanningSnapshot;
  shared: boolean;
  shareId: string | null;
  createdAt: string;
}

/** `clientId` (uuid) es la clave de idempotencia al migrar del invitado a la cuenta. */
export interface NewTrip {
  clientId: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
  /** El navegador (invitado) no lo guarda: pesa ~150 KB por viaje. */
  snapshot?: PlanningSnapshot;
}
export type { Vehicle };
