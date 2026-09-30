import { CarFront, ChevronDown } from "lucide-react";
import { routeChargeCapPct, socFloors } from "@/domain/ev/core/trip-config";
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
  const floor = socFloors(conditions).arrivalTargetPct;

  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => openVehicle(true)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-left transition-colors hover:border-accent/70 hover:bg-accent/15"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">
          <CarFront className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-accent">
            Vehículo
          </span>
          <span className="block truncate text-base font-semibold text-fg">{vehicleLabel(vehicle)}</span>
          <span className="block truncate text-xs text-muted">{vehicleSub(vehicle)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent">
          Cambiar
          <ChevronDown className="size-4" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => openBattery(true)}
        className="flex min-h-11 min-w-[4.75rem] flex-col items-stretch justify-center gap-1 rounded-xl bg-bg-elevated px-2.5 hover:bg-surface-2"
        aria-label={`Batería ${formatPct(soc)}. Abrir gestión`}
      >
        <span className="font-mono text-sm tabular-nums text-accent">{formatPct(soc)}</span>
        <BatteryPack soc={soc} floor={floor} maxTravel={routeChargeCapPct()} cells={8} compact />
      </button>
    </div>
  );
}
