import type { StationCatalog } from "@/domain/ports/station-catalog";
import { getStationDataset } from "./service";

/** El dataset consolidado de electrolineras (memoria → Postgres → refresco), como lo usa la app. */
export class DatasetStationCatalog implements StationCatalog {
  getDataset() {
    return getStationDataset();
  }
}
