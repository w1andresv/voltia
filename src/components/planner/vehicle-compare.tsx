"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront } from "lucide-react";
import { vehicleLabel, vehicleSub } from "@/domain/vehicles";
import { COMPARE_PATH, MAX_COMPARED, compareHref } from "@/lib/compare-link";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * "Comparar con otros vehículos": el usuario elige 1 o `MAX_COMPARED`
 * vehículos de su lista y la comparativa lado a lado se abre en /comparar,
 * sobre la ruta elegida del plan.
 */
export function VehicleComparePicker() {
  const router = useRouter();
  const vehicles = usePlanner((s) => s.vehicles);
  const current = usePlanner((s) => s.selectedVehicle());
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const others = vehicles.filter((v) => v.id !== current.id);
  if (!others.length) return null;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => {
          setOpen(true);
          // Así la pantalla ya está en el navegador si después se pierde la señal.
          router.prefetch(COMPARE_PATH);
        }}
      >
        <CarFront className="size-4" />
        Comparar con otros vehículos
      </Button>
    );
  }

  const full = picked.length >= MAX_COMPARED;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Comparar con…</h2>
        <button
          type="button"
          className="min-h-11 px-1 text-xs text-subtle hover:text-muted"
          onClick={() => {
            setOpen(false);
            setPicked([]);
          }}
        >
          Cancelar
        </button>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Elige 1 o {MAX_COMPARED} vehículos para verlos al lado del {vehicleLabel(current)} en esta
        ruta.
      </p>
      <ul className="grid gap-1.5">
        {others.map((v) => {
          const on = picked.includes(v.id);
          const disabled = full && !on;
          return (
            <li key={v.id}>
              <label
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                  on ? "border-accent/60 bg-accent/15" : "border-transparent bg-bg-elevated",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={on}
                  disabled={disabled}
                  onChange={() => toggle(v.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {vehicleLabel(v)}
                  </span>
                  <span className="block truncate text-xs text-subtle">
                    {vehicleSub(v)} · {v.batteryKwh} kWh · {v.dcMaxKw} kW DC
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {full ? (
        <p className="text-xs text-subtle">Máximo {MAX_COMPARED} vehículos además del tuyo.</p>
      ) : null}
      <Button
        type="button"
        className="w-full"
        disabled={!picked.length}
        onClick={() => router.push(compareHref(picked))}
      >
        Ver comparativa
        {picked.length ? ` (${picked.length + 1} vehículos)` : ""}
      </Button>
    </div>
  );
}
