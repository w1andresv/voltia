"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Search } from "lucide-react";
import { vehicleLabel, vehicleMatches, vehicleSub } from "@/domain/vehicles";
import { COMPARE_PATH, MAX_COMPARED, compareHref } from "@/lib/compare-link";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  skipKeyboardOnTouch,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * "Comparar con otros vehículos": el botón abre un modal donde el usuario elige
 * 1 o `MAX_COMPARED` vehículos de su lista; la comparativa lado a lado se abre
 * en /comparar, sobre la ruta elegida del plan.
 */
export function VehicleComparePicker() {
  const router = useRouter();
  const vehicles = usePlanner((s) => s.vehicles);
  const current = usePlanner((s) => s.selectedVehicle());
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const others = vehicles.filter((v) => v.id !== current.id);
  if (!others.length) return null;

  const shown = others.filter((v) => picked.includes(v.id) || vehicleMatches(v, query));
  const full = picked.length >= MAX_COMPARED;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Así la pantalla ya está en el navegador si después se pierde la señal.
          router.prefetch(COMPARE_PATH);
        } else {
          setPicked([]);
          setQuery("");
        }
      }}
    >
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <CarFront className="size-4" />
        Comparar con otros vehículos
      </Button>
      <DialogContent onOpenAutoFocus={skipKeyboardOnTouch}>
        <DialogHeader>
          <DialogTitle>Comparar vehículos</DialogTitle>
          <DialogDescription>
            Elige 1 o {MAX_COMPARED} vehículos para verlos al lado del {vehicleLabel(current)} en
            esta ruta.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar marca, modelo o versión"
            aria-label="Buscar vehículo para comparar"
            className="pl-9"
          />
        </div>

        <ul className="grid max-h-80 grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto pr-1">
          {shown.map((v) => {
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
          {!shown.length ? (
            <li className="py-6 text-center text-sm text-muted">
              Ningún vehículo coincide con «{query.trim()}».
            </li>
          ) : null}
        </ul>

        <div className="mt-4 grid gap-2">
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
      </DialogContent>
    </Dialog>
  );
}
