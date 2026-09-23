import type { PlanRequestShape, TripSummaryShape } from "@/domain/schemas";
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
  shared: boolean;
  shareId: string | null;
  createdAt: string;
}

/** `clientId` (uuid) es la clave de idempotencia al migrar del invitado a la cuenta. */
export interface NewTrip {
  clientId: string;
  request: PlanRequestShape;
  summary: TripSummaryShape;
}
export type { Vehicle };
