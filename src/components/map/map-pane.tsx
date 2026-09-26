import { useMemo } from "react";
import { Loader } from "lucide-react";
import { usePlanner } from "@/lib/store";
import { MapView } from "./map-view";
import { useBindMapClick } from "@/components/planner/map-click";
import { useStationDataset } from "@/components/stations/use-station-dataset";
import { toDisplayCharger } from "@/domain/stations/to-charger";
import type { ChargerAction } from "./map-types";

function noopHover(_km: number | null) {}

export function MapPane({ mode }: { mode: ChargerAction }) {
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const plans = usePlanner((s) => s.plans);
  const selectedPlanId = usePlanner((s) => s.selectedPlanId);
  const selectPlan = usePlanner((s) => s.selectPlan);
  const plan = plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;
  const alternatives = useMemo(
    () => (plan ? plans.filter((p) => p.id !== plan.id) : []),
    [plans, plan],
  );
  const hoverKm = usePlanner((s) => s.hoverKm);
  const setHoverKm = usePlanner((s) => s.setHoverKm);
  const armed = usePlanner((s) => s.mapClickArmed);
  const searching = usePlanner((s) => s.placeSearchOpen);
  const seed = usePlanner((s) => s.stationSeed);
  const onMapClick = useBindMapClick();
  const { data: dataset, isPending } = useStationDataset();
  const chargers = useMemo(() => (dataset?.stations ?? []).map(toDisplayCharger), [dataset]);
  const setMapBounds = usePlanner((s) => s.setMapBounds);
  const isPlan = mode === "plan";
  const isStations = mode === "stations";
  // El mapa solo permite elegir un punto cuando el usuario pulsó "En el mapa".
  const planClickOpen = armed === "origin" || armed === "destination" || armed === "waypoint";

  return (
    <div className="relative h-full w-full">
      <MapView
        origin={isPlan ? origin : null}
        destination={isPlan ? destination : null}
        plan={isPlan ? plan : null}
        alternatives={isPlan ? alternatives : []}
        onSelectRoute={selectPlan}
        chargers={chargers}
        showAllChargers
        hoverKm={isPlan ? hoverKm : null}
        onHoverKm={isPlan ? setHoverKm : noopHover}
        onMapClick={onMapClick}
        mapClickEnabled={
          isPlan
            ? planClickOpen && !searching
            : isStations
              ? armed === "station" && !searching && !seed
              : false
        }
        mapLocked={isPlan ? searching : isStations ? Boolean(searching || seed) : false}
        chargerAction={mode}
        onViewChange={setMapBounds}
      />
      {isPending && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-surface/95 px-6 py-4 shadow-float">
            <Loader className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted">Cargando electrolineras...</p>
          </div>
        </div>
      )}
    </div>
  );
}
