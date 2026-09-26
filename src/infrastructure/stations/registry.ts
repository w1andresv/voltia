import type { StationSource } from "./sources/types";
import { osmSource } from "./sources/osm";
import { siveeicSource } from "./sources/siveeic";
import { communitySource } from "./sources/community";
import { catalogSource } from "./sources/catalog";

/** Único lugar donde se agregan o quitan fuentes del dataset consolidado. */
export const STATION_SOURCES: StationSource[] = [osmSource, siveeicSource, communitySource, catalogSource];
