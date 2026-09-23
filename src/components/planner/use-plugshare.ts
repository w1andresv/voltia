import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getPlugshareStatusFn, queryPlugshareRegionFn } from "@/server/actions/chargers";
import type { Charger } from "@/domain/types";
import { usePlanner } from "@/lib/store";

const EMPTY: Charger[] = [];

/** ¿El servidor tiene PLUGSHARE_TOKEN? El navegador no maneja credenciales de PlugShare. */
export function usePlugshareEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["plugshare-status"],
    queryFn: () => getPlugshareStatusFn(),
    staleTime: Infinity,
    retry: false,
  });
  return Boolean(data?.enabled);
}

export function usePlugshareLayer() {
  const serverEnabled = usePlugshareEnabled();
  const bounds = usePlanner((s) => s.mapBounds);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(false);
  }, [serverEnabled]);

  const enabled = serverEnabled && Boolean(bounds) && !blocked;

  const lat = bounds ? (bounds.minLat + bounds.maxLat) / 2 : 0;
  const lon = bounds ? (bounds.minLon + bounds.maxLon) / 2 : 0;
  const spanLat = bounds ? Math.max(0.04, bounds.maxLat - bounds.minLat) : 0;
  const spanLng = bounds ? Math.max(0.04, bounds.maxLon - bounds.minLon) : 0;
  const key = enabled
    ? `${lat.toFixed(2)}:${lon.toFixed(2)}:${spanLat.toFixed(2)}:${spanLng.toFixed(2)}`
    : "off";

  return useQuery({
    queryKey: ["plugshare-region", key],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const res = await queryPlugshareRegionFn({
        data: { latitude: lat, longitude: lon, spanLat, spanLng },
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
