import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { reversePlaceFn } from "@/server/actions/plan";
import type { Place } from "@/domain/types";
import { usePlanner } from "@/lib/store";

let ignoreUntil = 0;

export function suppressMapClicks(ms = 600) {
  ignoreUntil = Date.now() + ms;
}

export function useBindMapClick() {
  const reverse = useMutation({
    mutationFn: (p: { lat: number; lon: number }) => reversePlaceFn({ data: p }),
  });

  return async (lat: number, lon: number) => {
    if (Date.now() < ignoreUntil) return;
    const s = usePlanner.getState();
    const armed = s.mapClickArmed;
    const canFillEnds = !s.origin || !s.destination;
    if (!armed && !canFillEnds) return;

    let place: Place;
    try {
      place = await reverse.mutateAsync({ lat, lon });
    } catch {
      toast.error("No se pudo leer esa ubicación");
      return;
    }
    const now = usePlanner.getState();
    const slot = now.mapClickArmed;

    if (slot === "station") {
      now.setStationSeed({ lat, lon, address: place.label });
      now.setMapClickArmed(null);
      return;
    }
    if (slot === "waypoint") {
      if (now.waypoints.length >= 3) {
        toast.error("Ya hay tres paradas en la ruta");
        return;
      }
      now.setWaypoints([...now.waypoints, place]);
      now.setMapClickArmed(null);
      toast.success("Parada añadida desde el mapa");
      return;
    }
    if (slot === "origin" || !now.origin) {
      now.setOrigin(place);
      now.setMapClickArmed(now.destination ? null : slot === "origin" ? "destination" : null);
      toast.success(now.destination ? "Origen fijado desde el mapa" : "Origen fijado. Toca el mapa para el destino.");
      return;
    }
    if (slot === "destination" || !now.destination) {
      now.setDestination(place);
      now.setMapClickArmed(null);
      toast.success("Destino fijado desde el mapa");
    }
  };
}
