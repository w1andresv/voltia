import type { Charger, Place, RoutePlan } from "@/lib/domain/types";

export type ChargerAction = "browse" | "plan" | "stations";

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  zoom: number;
};

export interface LeafletMapProps {
  origin: Place | null;
  destination: Place | null;
  plan: RoutePlan | null;
  chargers: Charger[];
  showAllChargers: boolean;
  hoverKm: number | null;
  onHoverKm: (km: number | null) => void;
  onMapClick: (lat: number, lon: number) => void;
  mapClickEnabled: boolean;
  mapLocked: boolean;
  chargerAction?: ChargerAction;
  onViewChange?: (bounds: MapBounds) => void;
}
