import { useQuery } from "@tanstack/react-query";
import { listStationsFn } from "@/server/actions/stations";
import { useActor } from "@/infrastructure/auth/use-actor";

/**
 * Admins see the moderation queue (pending + rejected + approved); everyone
 * else only sees approved stations — listStationsFn enforces the same rule
 * server-side, this just avoids asking for data the server would refuse.
 */
export function useCommunityStations() {
  const actor = useActor();
  const status = actor.role === "admin" ? "all" : "approved";
  return useQuery({
    queryKey: ["stations", status],
    queryFn: () => listStationsFn({ data: { status } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
