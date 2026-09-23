import { ChevronDown } from "lucide-react";
import { safetyPct } from "@/domain/types";
import { vehicleLabel, vehicleSub } from "@/domain/vehicles";
import { formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { BatteryPack } from "./battery-panel";

export function VehicleBar() {
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const conditions = usePlanner((s) => s.conditions);
  const soc = conditions.initialSoc;
  const openVehicle = usePlanner((s) => s.setVehicleModalOpen);
  const openBattery = usePlanner((s) => s.setBatteryOpen);
  const floor = Math.max(safetyPct(conditions), vehicle.minSocRecommended, conditions.arrivalSoc);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => openVehicle(true)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg bg-bg-elevated px-3 py-2 text-left hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{vehicleLabel(vehicle)}</span>
          <span className="block truncate text-xs text-muted">{vehicleSub(vehicle)}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      <button
        type="button"
        onClick={() => openBattery(true)}
        className="flex h-11 min-w-[4.75rem] flex-col items-stretch justify-center gap-1 rounded-lg bg-bg-elevated px-2.5 hover:bg-surface-2"
        aria-label={`Batería ${formatPct(soc)}. Abrir gestión`}
      >
        <span className="font-mono text-sm tabular-nums text-accent">{formatPct(soc)}</span>
        <BatteryPack soc={soc} floor={floor} maxTravel={vehicle.maxSocTravel} cells={8} compact />
      </button>
    </div>
  );
}
