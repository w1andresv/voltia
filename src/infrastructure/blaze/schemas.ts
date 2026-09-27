import { z } from "zod";

/**
 * Respuestas de la API pública de Blaze (v1) tal como llegan
 * (docs/blaze/api-publica-v1.md). Lo que depende de un scope de la key puede
 * faltar: solo `id` y `name` son obligatorios. Un cambio de la API rompe
 * aquí y no en el dominio.
 */
export const BlazeStatusSchema = z.enum([
  "en_servicio",
  "mantenimiento",
  "fuera_servicio",
  "desconocido",
]);

/** Un estado nuevo que la documentación no lista se lee como "desconocido". */
const Status = BlazeStatusSchema.catch("desconocido");
const OptionalNumber = z.number().finite().nullish();
const OptionalString = z.string().nullish();

export const BlazeChargerSchema = z
  .object({
    connectorType: OptionalString,
    powerKw: OptionalNumber,
    status: Status.nullish(),
  })
  .passthrough();

export const BlazeStationSchema = z
  .object({
    id: z.union([z.number(), z.string().min(1)]),
    name: z.string().min(1),
    city: OptionalString,
    status: Status.nullish(),
    verified: z.boolean().nullish(),
    operator: OptionalString,
    lat: OptionalNumber,
    lon: OptionalNumber,
    address: OptionalString,
    /** Texto separado por comas, p. ej. "CCS2, Tipo 2". */
    connectors: OptionalString,
    maxKw: OptionalNumber,
    chargersCount: z.number().int().nonnegative().nullish(),
    /** Solo en el detalle (/stations/{id}), con el scope chargers:read. */
    chargers: z.array(BlazeChargerSchema).nullish(),
  })
  .passthrough();

export const BlazeStationListSchema = z.array(BlazeStationSchema);

export type BlazeStatus = z.infer<typeof BlazeStatusSchema>;
export type BlazeCharger = z.infer<typeof BlazeChargerSchema>;
export type BlazeStation = z.infer<typeof BlazeStationSchema>;
