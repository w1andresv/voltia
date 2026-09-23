"use client";

import { usePathname } from "next/navigation";
import { MapPane } from "./map-pane";

/** Holder + stations map. The planner map lives in the route slot so hydration stays aligned. */
export function MapHost() {
  const pathname = usePathname();
  const stations = pathname.startsWith("/electrolineras");

  return (
    <div
      id="voltia-map-holder"
      className={
        stations
          ? "fixed inset-x-0 bottom-0 top-14 z-0"
          : "pointer-events-none fixed inset-x-0 bottom-0 top-14 -z-10"
      }
    >
      {stations ? <MapPane mode="stations" /> : null}
    </div>
  );
}
