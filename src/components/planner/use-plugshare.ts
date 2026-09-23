import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryPlugshareRegionFn } from "@/lib/api/chargers";
import type { Charger } from "@/lib/domain/types";
import { isPlugshareToken } from "@/lib/plugshare";
import { usePlanner } from "@/lib/store";

const EMPTY: Charger[] = [];

export function usePlugshareLayer() {
  const token = usePlanner((s) => s.plugshareToken);
  const bounds = usePlanner((s) => s.mapBounds);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(false);
  }, [token]);

  const enabled = isPlugshareToken(token) && Boolean(bounds) && !blocked;

  const lat = bounds ? (bounds.minLat + bounds.maxLat) / 2 : 0;
  const lon = bounds ? (bounds.minLon + bounds.maxLon) / 2 : 0;
  const spanLat = bounds ? Math.max(0.04, bounds.maxLat - bounds.minLat) : 0;
  const spanLng = bounds ? Math.max(0.04, bounds.maxLon - bounds.minLon) : 0;
  const key = enabled
    ? `${lat.toFixed(2)}:${lon.toFixed(2)}:${spanLat.toFixed(2)}:${spanLng.toFixed(2)}`
    : "off";

  return useQuery({
    queryKey: ["plugshare-region", key, token ? `${token.length}:${token.slice(0, 4)}` : "off"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const res = await queryPlugshareRegionFn({
        data: { latitude: lat, longitude: lon, spanLat, spanLng, token },
      });
      if (res.warning) {
        toast.message(res.warning, { id: "plugshare-warn" });
        if (/rechazó/.test(res.warning)) setBlocked(true);
      }
      return res.chargers;
    },
    placeholderData: (prev) => prev ?? EMPTY,
  });
}