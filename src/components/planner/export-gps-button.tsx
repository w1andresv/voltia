import { Navigation } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { getAppleMapsUrl, getGoogleMapsUrl, getWazeUrl, singleDestinationFor } from "@/lib/navigators";
import { usePlanner } from "@/lib/store";
import type { RoutePlan } from "@/domain/types";

/** Abre la ruta planificada en la app de navegación elegida, en una pestaña nueva. */
export function ExportGpsButton({ plan }: { plan: RoutePlan }) {
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  if (!origin || !destination) return null;

  const single = singleDestinationFor(plan.stops, destination);
  const waypoints = plan.stops.map((s) => ({ lat: s.charger.lat, lon: s.charger.lon }));

  function open(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-11">
          <Navigation className="size-4" />
          Exportar a GPS
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-1">
        <button
          type="button"
          className="flex h-11 w-full items-center rounded-md px-3 text-sm hover:bg-surface-2"
          onClick={() => open(getGoogleMapsUrl(origin, destination, waypoints))}
        >
          Google Maps
        </button>
        <button
          type="button"
          className="flex h-11 w-full items-center rounded-md px-3 text-sm hover:bg-surface-2"
          onClick={() => open(getWazeUrl(single))}
        >
          Waze
        </button>
        <button
          type="button"
          className="flex h-11 w-full items-center rounded-md px-3 text-sm hover:bg-surface-2"
          onClick={() => open(getAppleMapsUrl(single))}
        >
          Apple Maps
        </button>
      </PopoverContent>
    </Popover>
  );
}
