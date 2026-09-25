import { useMemo } from "react";
import { usePlanner } from "@/lib/store";
import { MapView } from "./map-view";
import { useBindMapClick } from "@/components/planner/map-click";
import { useChargerNetwork } from "@/components/planner/use-charger-network";
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
  const chargers = useChargerNetwork();
  const setMapBounds = usePlanner((s) => s.setMapBounds);
  const isPlan = mode === "plan";
  const isStations = mode === "stations";
  // El mapa solo permite elegir un punto cuando el usuario pulsó "En el mapa".
  const planClickOpen = armed === "origin" || armed === "destination" || armed === "waypoint";

  return (
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
  );
}
