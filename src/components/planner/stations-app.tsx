"use client";

import { useEffect } from "react";
import { Plus, X } from "lucide-react";
import { isPlugshareToken } from "@/lib/plugshare";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { StationHub, StationsButton } from "./station-hub";

export function StationsApp() {
  const setArmed = usePlanner((s) => s.setMapClickArmed);
  const setShowAll = usePlanner((s) => s.setShowAllChargers);
  const armed = usePlanner((s) => s.mapClickArmed);
  const seed = usePlanner((s) => s.stationSeed);
  const plugshareOn = usePlanner((s) => isPlugshareToken(s.plugshareToken));
  const adding = armed === "station" && !seed;

  useEffect(() => {
    setShowAll(true);
  }, [setShowAll]);

  useEffect(() => () => setArmed(null), [setArmed]);

  return (
    <div className="pointer-events-none relative z-20 h-dvh w-full overflow-hidden pt-14">
      {adding ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-24 z-20 flex justify-center px-3 md:bottom-8">
          <button
            type="button"
            className="flex h-12 items-center gap-2 rounded-full bg-surface px-4 text-sm text-fg shadow-float"
            onClick={() => setArmed(null)}
          >
            <X className="size-4 text-muted" />
            Cancelar ubicación
          </button>
        </div>
      ) : (
        <div className="pointer-events-auto absolute bottom-6 right-4 z-20 md:bottom-8 md:right-8">
          <Button className="h-14 rounded-full px-5 shadow-float" onClick={() => setArmed("station")}>
            <Plus className="size-5" />
            Agregar electrolinera
          </Button>
        </div>
      )}

      {adding ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-3">
          <div className="rounded-lg bg-surface px-3 py-2 text-sm shadow-float">Toca el mapa para ubicar la estación</div>
        </div>
      ) : (
        <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
          <StationsButton />
          {plugshareOn ? (
            <div className="rounded-md bg-surface/90 px-2 py-1 text-xs text-muted shadow-float">
              Incluye PlugShare
            </div>
          ) : null}
        </div>
      )}

      <div className="pointer-events-auto">
        <StationHub />
      </div>
    </div>
  );
}
