import type { StationDataset } from "../stations/model";

/**
 * El listado consolidado de electrolineras que usa el planificador. Se llama
 * StationCatalog para no confundirlo con `StationSource`, las fuentes del
 * dataset (infrastructure/stations/sources).
 */
export interface StationCatalog {
  getDataset(): Promise<StationDataset>;
}
