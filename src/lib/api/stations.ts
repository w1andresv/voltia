"use server";

import { z } from "zod";
import type { Charger, StationStatus } from "@/lib/domain/types";

const ConnectorSchema = z.enum(["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"]);

const SocketSchema = z.object({
  connector: ConnectorSchema,
  powerKw: z.number().min(1).max(500),
  count: z.number().int().min(1).max(40),
});

const StationInput = z.object({
  name: z.string().trim().min(3).max(120),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  address: z.string().trim().max(200).optional(),
  operator: z.string().trim().max(80).optional(),
  sockets: z.array(SocketSchema).min(1).max(8),
  openingHours: z.string().trim().max(80).optional(),
  pricePerKwh: z.number().min(0).max(50_000).nullable().optional(),
  priceCurrency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(600).optional(),
  photos: z.array(z.string().max(180_000)).max(2).optional(),
  availability: z.enum(["unknown", "available", "occupied", "offline"]).optional(),
});

const ReviewInput = z.object({
  id: z.string().min(1),
  status: z.enum(["approved", "rejected", "pending"]),
  reviewNote: z.string().trim().max(300).optional(),
});

export async function listStationsFn(input?: { data?: { status?: StationStatus | "all" } }): Promise<Charger[]> {
  const data = input?.data ?? {};
  const { loadCommunityChargers } = await import("./stations-db");
  return loadCommunityChargers(data.status ?? "all");
}

export async function createStationFn(input: { data: unknown }): Promise<Charger> {
  const data = StationInput.parse(input.data);
  const { insertStation } = await import("./stations-db");
  return insertStation(data);
}

export async function updateStationFn(input: { data: unknown }): Promise<Charger> {
  const data = StationInput.extend({ id: z.string().min(1) }).parse(input.data);
  const { patchStation } = await import("./stations-db");
  const { id, ...rest } = data;
  return patchStation(id, rest);
}

export async function reviewStationFn(input: { data: unknown }): Promise<Charger> {
  const data = ReviewInput.parse(input.data);
  const { setStationStatus } = await import("./stations-db");
  return setStationStatus(data.id, data.status, data.reviewNote);
}
