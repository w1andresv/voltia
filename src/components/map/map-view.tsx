import { useEffect, useState, type ComponentType } from "react";
import type { LeafletMapProps } from "./map-types";

const leafletPromise =
  typeof window === "undefined" ? null : import("./leaflet-map").then((m) => m.LeafletMap);

export function MapView(props: LeafletMapProps) {
  const [MapImpl, setMapImpl] = useState<ComponentType<LeafletMapProps> | null>(null);

  useEffect(() => {
    if (!leafletPromise) return;
    let live = true;
    void leafletPromise.then((mod) => {
      if (live) setMapImpl(() => mod);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!MapImpl) {
    return <div className="absolute inset-0 bg-bg" aria-hidden="true" />;
  }
  return <MapImpl {...props} />;
}
