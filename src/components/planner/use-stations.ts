import { useQuery } from "@tanstack/react-query";
import { listStationsFn } from "@/lib/api/stations";

export function useCommunityStations() {
  return useQuery({
    queryKey: ["stations"],
    queryFn: () => listStationsFn({ data: { status: "all" } }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
