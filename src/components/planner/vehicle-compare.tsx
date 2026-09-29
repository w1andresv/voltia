"use client";

import { useEffect, useMemo, useState } from "react";
import { CarFront, Check } from "lucide-react";
import {
  planOnRoute,
  rankVehiclesOnRoute,
  type VehicleOnRoute,
} from "@/domain/ev/compare-vehicles";
import type { SnapshotInputs } from "@/domain/ev/compute-plan";
import type { RoutePlan } from "@/domain/types";
import { vehicleLabel, vehicleSub } from "@/domain/vehicles";
import { formatMinutes, formatPct, formatSoc } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { depletionSentence } from "./depletion-notice";

/**
 * Plan de cada uno de los otros vehículos de la lista en la ruta `routeId`,
 * con los mismos datos del plan en pantalla. Se calculan de a uno por vez
 * (un vehículo por tarea) para no trabar la pantalla.
 */
function useOtherVehiclesOnRoute(routeId: string, enabled: boolean) {
  const geo = usePlanner((s) => s.geo);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const vehicles = usePlanner((s) => s.vehicles);
  const selectedId = usePlanner((s) => s.selectedVehicleId);
  // Mientras se arrastra un control de condiciones no se recalcula la lista entera.
  const conditions = useDebouncedValue(
    usePlanner((s) => s.conditions),
    300,
  );
  const others = useMemo(() => vehicles.filter((v) => v.id !== selectedId), [vehicles, selectedId]);
  // Cada cambio de datos es una corrida nueva; las filas de una corrida vieja no se muestran.
  const run = useMemo(
    () => ({ geo, origin, destination, others, conditions, routeId }),
    [geo, origin, destination, others, conditions, routeId],
  );
  const [done, setDone] = useState<{ run: typeof run; rows: VehicleOnRoute[] } | null>(null);

  useEffect(() => {
    const { geo, origin, destination, others, conditions, routeId } = run;
    if (!enabled || !geo || !origin || !destination) return;
    let cancelled = false;
    const rows: VehicleOnRoute[] = [];
    const next = (i: number) => {
      if (cancelled || i >= others.length) return;
      const vehicle = others[i]!;
      const plan = planOnRoute(
        geo as SnapshotInputs,
        { origin, destination },
        routeId,
        vehicle,
        conditions,
      );
      rows.push({ vehicle, plan });
      setDone({ run, rows: [...rows] });
      timer = setTimeout(() => next(i + 1), 0);
    };
    let timer = setTimeout(() => next(0), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, run]);

  return {
    rows: done?.run === run ? done.rows : [],
    total: others.length,
    initialSoc: conditions.initialSoc,
  };
}

/** "+25 min vs. tu vehículo" (vacío si alguno no llega o la diferencia no se nota). */
function deltaText(plan: RoutePlan, mine: RoutePlan): string {
  if (!plan.feasible || !mine.feasible) return "";
  const d = plan.totalMinutes - mine.totalMinutes;
  if (Math.abs(d) < 1) return "Igual que tu vehículo";
  return `${d > 0 ? "+" : "−"}${formatMinutes(Math.abs(d))} vs. tu vehículo`;
}

/**
 * "¿Qué carro me conviene para esta ruta?": los demás vehículos de la lista
 * (catálogo y propios) en la misma ruta, con las mismas electrolineras, clima
 * y condiciones. Solo calcula al abrirla.
 */
export function VehicleCompare({ plan }: { plan: RoutePlan }) {
  const [open, setOpen] = useState(false);
  const current = usePlanner((s) => s.selectedVehicle());
  const setVehicleId = usePlanner((s) => s.setVehicleId);
  const { rows, total, initialSoc } = useOtherVehiclesOnRoute(plan.id, open);
  if (total === 0) return null;

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <CarFront className="size-4" />
        Comparar con otros vehículos
      </Button>
    );
  }

  const ranked = rankVehiclesOnRoute([{ vehicle: current, plan }, ...rows]);
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">
          Vehículos en esta ruta
        </h2>
        <button
          type="button"
          className="min-h-11 px-1 text-xs text-subtle hover:text-muted"
          onClick={() => setOpen(false)}
        >
          Ocultar
        </button>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Misma ruta ({plan.label}), mismas electrolineras y clima. Todos salen con{" "}
        {formatPct(initialSoc)} de batería.
      </p>
      <ul className="grid gap-2">
        {ranked.map(({ vehicle, plan: p }) => {
          const mine = vehicle.id === current.id;
          const delta = p && !mine ? deltaText(p, plan) : "";
          return (
            <li
              key={vehicle.id}
              className={cn(
                "rounded-lg border px-3 py-2.5",
                mine ? "border-accent/60 bg-accent/15" : "border-transparent bg-bg-elevated",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{vehicleLabel(vehicle)}</div>
                  <div className="truncate text-xs text-subtle">{vehicleSub(vehicle)}</div>
                </div>
                {mine ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-accent">
                    <Check className="size-3.5" /> Tu vehículo
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-11 shrink-0"
                    onClick={() => setVehicleId(vehicle.id)}
                  >
                    Usar este
                  </Button>
                )}
              </div>
              {p == null ? (
                <div className="mt-1.5 text-xs text-muted">No se pudo calcular en esta ruta.</div>
              ) : p.feasible ? (
                <>
                  <div className="mt-1.5 text-xs text-muted">
                    {formatMinutes(p.totalMinutes)} · {p.stops.length}{" "}
                    {p.stops.length === 1 ? "parada" : "paradas"}
                    {p.chargeMinutes > 0 ? ` · ${formatMinutes(p.chargeMinutes)} carga` : ""} ·
                    llega con {formatSoc(p.arrivalSoc)}
                  </div>
                  {delta ? <div className="mt-0.5 text-xs text-subtle">{delta}</div> : null}
                </>
              ) : (
                <div className="mt-1.5 text-xs text-danger">
                  No llega.{" "}
                  {p.depletion
                    ? depletionSentence(p.depletion, p.depletion.label ?? null)
                    : "Con las electrolineras de esta ruta no alcanza el destino."}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length < total ? (
        <p className="text-xs text-subtle" aria-live="polite">
          Calculando {rows.length + 1} de {total}…
        </p>
      ) : null}
    </div>
  );
}
