import type { Charger, LatLon } from "@/domain/types";

export interface ChargerProviderOptions {
  /** Credencial del proveedor cuando el caller trae la suya (p. ej. PlugShare). */
  token?: string;
}

export interface ChargerProviderResult {
  chargers: Charger[];
  warnings: string[];
}

/** Contrato común para cualquier fuente externa de electrolineras a lo largo de una ruta. */
export interface ChargerProvider {
  id: string;
  name: string;
  findAlong(samples: LatLon[], options?: ChargerProviderOptions): Promise<ChargerProviderResult>;
}
