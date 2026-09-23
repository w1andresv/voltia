"use client";

import { useRouter } from "next/navigation";
import { Route as RouteIcon } from "lucide-react";
import type { PlanRequestShape } from "@/domain/schemas";
import type { RoutePlan } from "@/lib/domain/types";
import { formatKm, formatMinutes } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ConsumptionChart } from "@/components/planner/consumption-chart";
import { ElevationChart } from "@/components/planner/elevation-chart";
import { Itinerary } from "@/components/planner/itinerary";
import { PlanStats } from "@/components/planner/stats";
import { RouteCompare } from "@/components/planner/route-compare";
import { SocChart } from "@/components/planner/soc-chart";

/**
 * Vista de un viaje compartido (/v/[shareId]) — sin sesión, sin el mapa
 * interactivo (MapHost es un singleton global atado al store del
 * planificador activo; añadirlo aquí requeriría desacoplarlo, fuera del
 * alcance de esta fase). Reusa los mismos componentes de estadísticas,
 * itinerario y gráficos que la pantalla principal del planificador.
 */
export function SharedTripView({
  request,
  plans,
  selectedId,
}: {
  request: PlanRequestShape;
  plans: RoutePlan[];
  selectedId: string;
}) {
  const router = useRouter();
  const applySavedRequest = usePlanner((s) => s.applySavedRequest);
  const selectedInStore = usePlanner((s) => s.selectedPlanId);
  const plan = plans.find((p) => p.id === (selectedInStore ?? selectedId)) ?? plans[0];

  if (!plan) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-20">
        <p className="text-sm text-muted">
          No se pudo recalcular este viaje ahora mismo. El origen o destino puede haber cambiado, o alguno de los
          servicios de mapas no respondió.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-fg">
            {request.origin.label} → {request.destination.label}
          </h1>
          <p className="text-xs text-muted">
            Viaje compartido en Voltia · {request.vehicle.brand} {request.vehicle.model} ·{" "}
            {formatKm(plan.distanceKm)} · {formatMinutes(plan.totalMinutes)}
          </p>
        </div>
        <Button
          size="sm"
          className="h-11 shrink-0"
          onClick={() => {
            applySavedRequest(request);
            router.push("/planificar");
          }}
        >
          <RouteIcon className="size-4" />
          Replanificar
        </Button>
      </div>

      <div className="space-y-3">
        <PlanStats plan={plan} />
        <RouteCompare plans={plans} />
      </div>
      <Itinerary plan={plan} />
      <ElevationChart plan={plan} />
      <SocChart plan={plan} />
      <ConsumptionChart plan={plan} />
    </main>
  );
}
