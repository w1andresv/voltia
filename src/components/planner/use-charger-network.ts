import { useMemo } from "react";
import type { Charger } from "@/domain/types";
import { isVerifiedForPlanning } from "@/domain/types";
import { uniqueByProximity } from "@/domain/geo";
import { CATALOG_CHARGERS } from "@/infrastructure/providers/chargers.catalog";
import { usePlanner } from "@/lib/store";
import { usePlugshareLayer } from "./use-plugshare";
import { useCommunityStations } from "./use-stations";

const EMPTY: Charger[] = [];

/** Single network: pending community (map only) + verified OSM/PlugShare/catalog/approved. */
export function useChargerNetwork(): Charger[] {
  const { data: community = EMPTY } = useCommunityStations();
  const { data: plugshare = EMPTY } = usePlugshareLayer();
  const live = usePlanner((s) => s.geo?.chargers) ?? EMPTY;
  return useMemo(() => {
    const pending = community.filter((c) => c.status === "pending");
    const verified = [
      ...community.filter(isVerifiedForPlanning),
      ...plugshare.filter(isVerifiedForPlanning),
      ...live.filter(isVerifiedForPlanning),
      ...CATALOG_CHARGERS.filter(isVerifiedForPlanning),
    ];
    return [...pending, ...uniqueByProximity<Charger>(verified, 0.12)];
  }, [community, live, plugshare]);
}