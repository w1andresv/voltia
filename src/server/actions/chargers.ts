"use server";

import { z } from "zod";
import type { Charger } from "@/domain/types";

const RegionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  spanLat: z.number().min(0.01).max(8),
  spanLng: z.number().min(0.01).max(8),
  token: z.string().max(4000).optional(),
});

export async function queryPlugshareRegionFn(input: { data: unknown }): Promise<{ chargers: Charger[]; warning?: string }> {
  const data = RegionSchema.parse(input.data);
  const { queryPlugshareRegion } = await import("@/infrastructure/providers/chargers.plugshare");
  return queryPlugshareRegion(data);
}
