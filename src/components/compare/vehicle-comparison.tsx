"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useIsFetching } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { planOnRoute } from "@/domain/ev/compare-vehicles";
import type { SnapshotInputs } from "@/domain/ev/compute-plan";
import { CONNECTOR_LABEL, type RoutePlan, type Vehicle } from "@/domain/types";
import { vehicleLabel, vehicleSub } from "@/domain/vehicles";
import { bestOf, type ComparedMetric } from "@/lib/compare-best";
import { parseCompareIds } from "@/lib/compare-link";
import {
  formatKm,
  formatKw,
  formatKwh,
  formatKwhPer100,
  formatMinutes,
  formatPct,
  formatSoc,
} from "@/lib/format";
import { loadLastTrip, type LastTrip } from "@/lib/last-trip";
import { plannerHref } from "@/lib/planner-routes";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUserContext } from "@/components/user/user-context";
import { depletionSentence } from "@/components/planner/depletion-notice";

const noSubscription = () => () => {};

/**
 * El viaje a comparar: el plan en pantalla o, si se recargó la página (el plan
 * vive en memoria), el último guardado en el navegador (PWA).
 */
function useTripToCompare() {
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const geo = usePlanner((s) => s.geo);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const conditions = usePlanner((s) => s.conditions);
  const routeId = usePlanner((s) => s.selectedPlanId ?? s.plans[0]?.id ?? null);
  const current = usePlanner((s) => s.selectedVehicle());
  const lastTrip = useMemo(() => (hydrated && !geo ? loadLastTrip() : null), [hydrated, geo]);

  if (geo && origin && destination && routeId) {
    return { geo, origin, destination, conditions, routeId, current, lastTrip: null };
  }
  if (lastTrip) {
    return {
      geo: lastTrip.geo,
      origin: lastTrip.origin,
      destination: lastTrip.destination,
      conditions: lastTrip.conditions,
      routeId: lastTrip.selectedPlanId ?? lastTrip.geo.routes[0]!.id,
      current: lastTrip.vehicle,
      lastTrip,
    };
  }
  return null;
}

/** "+12 min vs. el tuyo" frente al vehículo del plan (vacío si alguno no llega). */
function deltaMinutes(plan: RoutePlan | null, mine: RoutePlan | null): string {
  if (!plan?.feasible || !mine?.feasible) return "";
  const d = Math.round(plan.totalMinutes - mine.totalMinutes);
  if (d === 0) return "Igual que el tuyo";
  return `${d > 0 ? "+" : "−"}${formatMinutes(Math.abs(d))} vs. el tuyo`;
}

interface Column {
  vehicle: Vehicle;
  plan: RoutePlan | null;
  mine: boolean;
}

/** Una fila: el nombre arriba y una celda por vehículo; la mejor, destacada. */
function Row({
  label,
  columns,
  cell,
  metric,
}: {
  label: string;
  columns: Column[];
  cell: (c: Column) => ReactNode;
  metric?: ComparedMetric;
}) {
  const best = metric
    ? bestOf(
        columns.map((c) => c.plan),
        metric,
      )
    : [];
  return (
    <div className="border-t border-border py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("mt-1 grid gap-3", columns.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {columns.map((c, i) => (
          <div
            key={c.vehicle.id}
            className={cn(
              "min-w-0 text-sm tabular-nums",
              best.includes(i) ? "font-semibold text-accent" : "text-fg",
            )}
          >
            {best.includes(i) ? (
              <Check className="mr-1 inline size-3.5 align-[-2px]" aria-label="El mejor:" />
            ) : null}
            {cell(c)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lo que muestra una cifra del plan: "—" si no hay plan o el vehículo no llega. */
function arriving(c: Column, show: (p: RoutePlan) => ReactNode): ReactNode {
  return c.plan?.feasible ? show(c.plan) : <span className="text-subtle">—</span>;
}

function Stops({ plan }: { plan: RoutePlan | null }) {
  if (!plan) return <span className="text-subtle">—</span>;
  if (!plan.stops.length) return <span className="text-xs text-muted">Sin paradas</span>;
  return (
    <ol className="space-y-2">
      {plan.stops.map((st, n) => (
        <li key={`${st.charger.id}-${n}`} className="text-xs">
          <div className="line-clamp-2 font-medium text-fg">
            {n + 1}. {st.charger.name}
          </div>
          <div className="text-muted">
            {formatPct(st.arriveSoc)} → {formatPct(st.departSoc)}
          </div>
          <div className="text-muted">
            {formatMinutes(st.chargeMinutes)} · {formatKw(st.chargeKw)}
          </div>
          {st.adapter ? (
            <div className="text-warn">
              Adaptador {CONNECTOR_LABEL[st.adapter.from]} → {CONNECTOR_LABEL[st.adapter.to]}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Comparativa lado a lado (/comparar?vehiculos=a,b): el vehículo del plan y 1
 * o 2 más en la misma ruta, con las mismas electrolineras, clima y condiciones.
 * Se calcula en el navegador con los datos del plan, sin consultar proveedores.
 */
export function VehicleComparison() {
  const router = useRouter();
  const params = useSearchParams();
  const trip = useTripToCompare();
  const vehicles = usePlanner((s) => s.vehicles);
  const engineChoice = usePlanner((s) => s.engineChoice);
  const restoreTrip = usePlanner((s) => s.restoreTrip);
  const setVehicleId = usePlanner((s) => s.setVehicleId);
  const { ready } = useUserContext();
  const loadingCatalog = useIsFetching({ queryKey: ["catalog"] }) > 0;

  const ids = trip ? parseCompareIds(params.get("vehiculos"), trip.current.id) : [];
  const found = ids.flatMap((id) => vehicles.find((v) => v.id === id) ?? []);
  const missing = ids.filter((id) => !found.some((v) => v.id === id));
  const columns = useMemo<Column[]>(() => {
    if (!trip) return [];
    const snapshot = trip.geo as SnapshotInputs;
    const places = { origin: trip.origin, destination: trip.destination };
    return [trip.current, ...found].map((vehicle, i) => ({
      vehicle,
      plan: planOnRoute(snapshot, places, trip.routeId, vehicle, trip.conditions),
      mine: i === 0,
    }));
    // `found` cambia de identidad en cada render; sus ids alcanzan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.geo, trip?.routeId, trip?.conditions, trip?.current, found.map((v) => v.id).join()]);

  const planner = plannerHref(engineChoice);
  /** Vuelve al plan; si venía del guardado en el navegador, lo carga primero. */
  function backToPlan(lastTrip: LastTrip | null, vehicleId?: string) {
    if (lastTrip) restoreTrip(lastTrip);
    if (vehicleId) setVehicleId(vehicleId);
    router.push(planner);
  }

  if (!trip) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        <h1 className="text-lg font-semibold text-fg">Comparar vehículos</h1>
        <p className="text-sm text-muted">
          Primero planifica una ruta. Después, en los resultados, elige &quot;Comparar con otros
          vehículos&quot;.
        </p>
        <Button asChild>
          <Link href={planner}>Ir al planificador</Link>
        </Button>
      </div>
    );
  }

  if (missing.length && (!ready || loadingCatalog)) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Cargando vehículos…</p>;
  }

  const mine = columns[0]?.plan ?? null;
  const cols = columns.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-3">
      <button
        type="button"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:text-fg"
        onClick={() => backToPlan(trip.lastTrip)}
      >
        <ArrowLeft className="size-4" />
        Volver al plan
      </button>

      <h1 className="mt-1 text-lg font-semibold text-fg">Comparativa de vehículos</h1>
      <p className="mt-1 text-sm text-muted">
        {trip.origin.label} → {trip.destination.label}
        {mine ? ` · ${mine.label} · ${formatKm(mine.distanceKm)}` : ""}
      </p>
      <p className="mt-1 text-xs text-subtle">
        Misma ruta, mismas electrolineras y clima. Todos salen con{" "}
        {formatPct(trip.conditions.initialSoc)} de batería.
      </p>
      {missing.length ? (
        <p className="mt-2 text-xs text-warn">
          {missing.length === 1
            ? "Un vehículo del enlace ya no está"
            : "Dos vehículos del enlace ya no están"}{" "}
          en tu lista.
        </p>
      ) : null}

      {columns.length < 2 ? (
        <p className="mt-6 text-sm text-muted">
          No hay otro vehículo para comparar.{" "}
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={() => backToPlan(trip.lastTrip)}
          >
            Elige uno desde el plan
          </button>
          .
        </p>
      ) : (
        <>
          <div
            className={cn(
              "sticky top-0 z-10 -mx-4 mt-4 grid gap-3 bg-bg/95 px-4 py-2 backdrop-blur-md",
              cols,
            )}
          >
            {columns.map((c) => (
              <div key={c.vehicle.id} className="min-w-0">
                <div className="line-clamp-2 text-sm font-semibold leading-tight text-fg">
                  {vehicleLabel(c.vehicle)}
                </div>
                <div className="truncate text-xs text-subtle">{vehicleSub(c.vehicle)}</div>
                {c.mine ? (
                  <span className="mt-1 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                    Tu vehículo
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <Row
            label="Resultado"
            columns={columns}
            cell={(c) =>
              !c.plan ? (
                <span className="text-subtle">Sin datos de esta ruta</span>
              ) : c.plan.feasible ? (
                <span className="text-ok">Llega</span>
              ) : (
                <span className="text-danger">
                  No llega
                  {c.plan.depletion ? (
                    <span className="mt-0.5 block text-xs font-normal">
                      {depletionSentence(c.plan.depletion, c.plan.depletion.label ?? null)}
                    </span>
                  ) : null}
                </span>
              )
            }
          />
          <Row
            label="Tiempo total"
            metric="totalMinutes"
            columns={columns}
            cell={(c) =>
              arriving(c, (p) => (
                <>
                  {formatMinutes(p.totalMinutes)}
                  {!c.mine && deltaMinutes(p, mine) ? (
                    <span className="block text-xs font-normal text-subtle">
                      {deltaMinutes(p, mine)}
                    </span>
                  ) : null}
                </>
              ))
            }
          />
          <Row
            label="Manejo"
            columns={columns}
            cell={(c) => arriving(c, (p) => formatMinutes(p.driveMinutes))}
          />
          <Row
            label="Carga"
            metric="chargeMinutes"
            columns={columns}
            cell={(c) =>
              arriving(c, (p) =>
                p.chargeMinutes > 0 ? formatMinutes(p.chargeMinutes) : "Sin carga",
              )
            }
          />
          <Row
            label="Paradas"
            metric="stops"
            columns={columns}
            cell={(c) => arriving(c, (p) => p.stops.length)}
          />
          <Row
            label="Batería al llegar"
            metric="arrivalSoc"
            columns={columns}
            cell={(c) => arriving(c, (p) => formatSoc(p.arrivalSoc))}
          />
          <Row
            label="Energía del viaje"
            metric="energyKwh"
            columns={columns}
            cell={(c) =>
              arriving(c, (p) => (
                <>
                  {formatKwh(p.energyKwh)}
                  <span className="block text-xs font-normal text-subtle">
                    {formatKwhPer100(p.avgKwhPer100km)}
                  </span>
                </>
              ))
            }
          />
          <Row label="Dónde carga" columns={columns} cell={(c) => <Stops plan={c.plan} />} />

          <h2 className="mt-6 text-xs font-medium uppercase tracking-wider text-subtle">
            Datos del vehículo
          </h2>
          <Row label="Batería" columns={columns} cell={(c) => formatKwh(c.vehicle.batteryKwh)} />
          <Row label="Autonomía" columns={columns} cell={(c) => formatKm(c.vehicle.rangeKm)} />
          <Row
            label="Carga rápida máx."
            columns={columns}
            cell={(c) => formatKw(c.vehicle.dcMaxKw)}
          />
          <Row
            label="Carga lenta máx."
            columns={columns}
            cell={(c) => formatKw(c.vehicle.acMaxKw)}
          />
          <Row
            label="Conectores"
            columns={columns}
            cell={(c) => c.vehicle.connectors.map((k) => CONNECTOR_LABEL[k]).join(", ")}
          />

          <div className={cn("mt-4 grid gap-3 border-t border-border pt-4", cols)}>
            {columns.map((c) =>
              c.mine ? (
                <div key={c.vehicle.id} />
              ) : (
                <Button
                  key={c.vehicle.id}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 whitespace-normal px-2 py-2 text-xs"
                  onClick={() => backToPlan(trip.lastTrip, c.vehicle.id)}
                >
                  Usar este vehículo
                </Button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
