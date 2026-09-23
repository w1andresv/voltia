"use server";

import { z } from "zod";
import type { Charger } from "@/domain/types";
import { checkRateLimit, getClientIp } from "@/infrastructure/rate-limit";

const RegionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  spanLat: z.number().min(0.01).max(8),
  spanLng: z.number().min(0.01).max(8),
});

/**
 * ¿El servidor tiene PLUGSHARE_TOKEN? El navegador ya no maneja ninguna
 * credencial de PlugShare: solo pregunta si hay red que mostrar.
 */
export async function getPlugshareStatusFn(): Promise<{ enabled: boolean }> {
  const { isPlugshareToken } = await import("@/lib/plugshare");
  return { enabled: isPlugshareToken(process.env.PLUGSHARE_TOKEN ?? "") };
}

export async function queryPlugshareRegionFn(input: { data: unknown }): Promise<{ chargers: Charger[]; warning?: string }> {
  const data = RegionSchema.parse(input.data);
  // Con el token del operador, cada movimiento del mapa gastaría su cuota:
  // 60 consultas/min por IP (mismo patrón que planTripFn).
  await checkRateLimit("plugshare-region", await getClientIp(), 60, 60);
  const { queryPlugshareRegion } = await import("@/infrastructure/providers/chargers.plugshare");
  return queryPlugshareRegion(data);
}
