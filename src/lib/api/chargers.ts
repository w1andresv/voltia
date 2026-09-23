import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Charger } from "@/lib/domain/types";

const RegionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  spanLat: z.number().min(0.01).max(8),
  spanLng: z.number().min(0.01).max(8),
  token: z.string().max(4000).optional(),
});

export const queryPlugshareRegionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => RegionSchema.parse(d))
  .handler(async ({ data }): Promise<{ chargers: Charger[]; warning?: string }> => {
    const { queryPlugshareRegion } = await import("@/lib/providers/chargers.plugshare");
    return queryPlugshareRegion(data);
  });
