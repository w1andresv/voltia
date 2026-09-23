import { useQuery } from "@tanstack/react-query";
import { listMyTripsFn } from "@/lib/api/trips";

/** Historial de viajes guardados del usuario — solo se monta con sesión. */
export function useMyTrips() {
  return useQuery({
    queryKey: ["my-trips"],
    queryFn: () => listMyTripsFn(),
    staleTime: 60_000,
  });
}
