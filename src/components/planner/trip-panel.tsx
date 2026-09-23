import { useMutation } from "@tanstack/react-query";
import { ArrowDownUp, Flag, LoaderCircle, MapPin, Plus } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { planTripFn } from "@/server/actions/plan";
import { ChargerFacts } from "./charger-facts";
import { DEMO_TRIPS, usePlanner } from "@/lib/store";
import { formatKm, formatKwh, formatMinutes, formatPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ConsumptionChart } from "./consumption-chart";
import { ElevationChart } from "./elevation-chart";
import { Itinerary } from "./itinerary";
import { PlaceSearch } from "./place-search";
import { RouteCompare } from "./route-compare";
import { SocChart } from "./soc-chart";
import { PlanStats } from "./stats";
import { SaveTripButton } from "@/components/trips/save-trip-button";
import { TripParams } from "./trip-params";
import { VehicleBar } from "./vehicle-bar";
import type { RoutePlan } from "@/domain/types";

export function TripSetup() {
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const waypoints = usePlanner((s) => s.waypoints);
  const setOrigin = usePlanner((s) => s.setOrigin);
  const setDestination = usePlanner((s) => s.setDestination);
  const setWaypoints = usePlanner((s) => s.setWaypoints);
  const swap = usePlanner((s) => s.swapEnds);
  const applyDemo = usePlanner((s) => s.applyDemo);
  const setResult = usePlanner((s) => s.setResult);
  const plan = usePlanner((s) => s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0] ?? null);
  const armed = usePlanner((s) => s.mapClickArmed);
  const setArmed = usePlanner((s) => s.setMapClickArmed);
  const destInput = useRef<HTMLInputElement>(null);

  const planMut = useMutation({
    mutationFn: () => {
      const s = usePlanner.getState();
      const from = s.origin;
      const to = s.destination;
      if (!from || !to) throw new Error("Faltan origen o destino");
      const v = s.vehicles.find((item) => item.id === s.selectedVehicleId) ?? s.vehicles[0]!;
      return planTripFn({
        data: {
          origin: from,
          destination: to,
          waypoints: s.waypoints.filter((w) => w.label && w.lat && w.lon),
          vehicle: v,
          conditions: s.conditions,
          plugshareToken: s.plugshareToken || undefined,
        },
      });
    },
    onSuccess: (res) => {
      setResult(res.geo, res.plans, res.selectedId);
      if (res.geo.warnings.length) toast.message(res.geo.warnings[0]);
      requestAnimationFrame(() => {
        document.getElementById("voltia-map-slot")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "No se pudo planificar el viaje");
    },
  });

  const canPlan = Boolean(origin && destination) && !planMut.isPending;

  return (
    <section className="relative z-20 space-y-3 px-4 pb-3 pt-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Configuración del viaje</h2>
      <VehicleBar />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <PlaceSearch
            value={origin}
            onChange={(p) => {
              setOrigin(p);
              if (p && !destination) {
                requestAnimationFrame(() => destInput.current?.focus());
              }
            }}
            placeholder="Origen"
            icon={<MapPin className="size-4" />}
          />
          <PlaceSearch
            value={destination}
            onChange={setDestination}
            placeholder="Destino"
            icon={<Flag className="size-4" />}
            inputRef={destInput}
          />
        </div>
        <Button
          variant="secondary"
          size="icon"
          className="shrink-0"
          onClick={swap}
          aria-label="Invertir origen y destino"
        >
          <ArrowDownUp className="size-4" />
        </Button>
      </div>
      {waypoints.map((w, i) => (
        <PlaceSearch
          key={`${w.lat}-${i}`}
          value={w.label ? w : null}
          onChange={(p) => {
            const next = waypoints.slice();
            if (p) next[i] = p;
            else next.splice(i, 1);
            setWaypoints(next);
          }}
          placeholder={`Parada ${i + 1}`}
        />
      ))}
      <ul className="space-y-1 text-xs">
        <li className={origin ? "text-ok" : "text-warn"}>
          Punto de inicio {origin ? "✓" : "— falta"}
        </li>
        <li className={destination ? "text-ok" : "text-warn"}>
          Punto de destino {destination ? "✓" : "— falta"}
        </li>
      </ul>
      {!canPlan && !planMut.isPending ? (
        <p className="text-xs text-warn">
          {!origin && !destination
            ? "Faltan el punto de inicio y el destino para planificar el viaje."
            : !origin
              ? "Falta el punto de inicio. Búscalo o tócalo en el mapa."
              : "Falta el punto de destino. Búscalo o tócalo en el mapa."}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-11 flex-1"
          onClick={() => setWaypoints([...waypoints, { label: "", lat: 0, lon: 0 }].slice(0, 3))}
          disabled={waypoints.length >= 3}
        >
          <Plus className="size-4" />
          Parada
        </Button>
        <Button
          variant={armed ? "default" : "outline"}
          size="sm"
          className="h-11"
          onClick={() => setArmed(armed ? null : origin ? "destination" : "origin")}
        >
          Tocar mapa
        </Button>
      </div>
      <Button
        className="w-full"
        disabled={!canPlan}
        onClick={() => {
          if (!origin || !destination) {
            toast.error(
              !origin && !destination
                ? "Elige origen y destino antes de planificar."
                : !origin
                  ? "Falta el punto de inicio."
                  : "Falta el punto de destino.",
            );
            return;
          }
          planMut.mutate();
        }}
      >
        {planMut.isPending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Calculando ruta y energía
          </>
        ) : (
          "Planificar viaje"
        )}
      </Button>
      <TripParams />
      {!plan ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Ejemplos</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {DEMO_TRIPS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  applyDemo(t);
                  planMut.mutate();
                }}
                disabled={planMut.isPending}
                className="h-11 shrink-0 rounded-full bg-bg-elevated px-3 text-xs text-fg hover:bg-surface-2 disabled:opacity-60"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TripResults({ plan }: { plan: RoutePlan }) {
  const plans = usePlanner((s) => s.plans);
  const warnings = usePlanner((s) => s.geo?.warnings);
  const weather = usePlanner((s) => s.geo?.weather);

  return (
    <div className="space-y-8 px-4 pb-24 pt-2">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Resumen de la ruta</h2>
          <SaveTripButton plan={plan} />
        </div>
        <PlanStats plan={plan} />
        <RouteCompare plans={plans} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Puntos de carga</h2>
        {plan.canArriveWithoutCharge ? (
          <p className="text-sm leading-relaxed text-ok">
            La batería alcanza el destino. No se recomienda ninguna electrolinera.
          </p>
        ) : !plan.feasible ? (
          <p className="text-sm leading-relaxed text-danger">
            {plan.infeasibleReason ??
              "No se encontró una electrolinera verificada dentro de la autonomía disponible. No es posible generar una estrategia de recarga segura para este tramo."}
          </p>
        ) : plan.stops.length ? (
          <p className="text-xs leading-relaxed text-muted">
            Paradas en electrolineras reales y verificadas sobre la ruta o con un desvío razonable. El SOC de llegada respeta tu
            margen de seguridad.
          </p>
        ) : null}
        <Itinerary plan={plan} />
      </section>

      {plan.stops.length ? (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Detalles de electrolineras</h2>
          <ul className="space-y-3">
            {plan.stops.map((st) => (
              <li key={st.charger.id} className="rounded-xl bg-bg-elevated p-3">
                <ChargerFacts charger={st.charger} />
                <p className="mt-2 text-xs text-muted">
                  Llegas al {formatPct(st.arriveSoc)} · sales al {formatPct(st.departSoc)} · {formatMinutes(st.chargeMinutes)} ·{" "}
                  {formatKwh(st.energyAddedKwh)}
                  {st.fromRouteKm > 0.15 ? ` · ${formatKm(st.fromRouteKm, 1)} de la ruta` : " · sobre la ruta"}
                  {st.kmToNext > 0 ? ` · siguiente en ${formatKm(st.kmToNext)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">Recomendaciones de carga</h2>
        <ChargeAdvice plan={plan} />
        <p className="text-xs text-muted">Toca un marcador del mapa para usarlo como origen, destino o parada.</p>
        {(warnings ?? []).map((w) => (
          <p key={w} className="text-xs text-warn">
            {w}
          </p>
        ))}
      </section>

      <section>
        <ElevationChart plan={plan} />
      </section>

      <section>
        <ConsumptionChart plan={plan} />
      </section>

      <section>
        <SocChart plan={plan} />
        {weather ? (
          <p className="mt-2 text-xs text-subtle">
            Clima en ruta: {Math.round(weather.temperatureC)}°C · viento {Math.round(weather.windKmh)} km/h
            {weather.source ? ` · ${weather.source}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ChargeAdvice({ plan }: { plan: RoutePlan }) {
  if (plan.canArriveWithoutCharge) {
    return (
      <p className="rounded-lg bg-ok/10 px-3 py-2.5 text-sm leading-relaxed text-ok">
        Puedes llegar sin recargar. Reserva {formatPct(plan.safetyPct)} y llegas con {formatPct(plan.arrivalSoc)}.
      </p>
    );
  }
  if (!plan.feasible) {
    return (
      <p className="rounded-lg bg-danger/10 px-3 py-2.5 text-sm leading-relaxed text-danger">
        {plan.infeasibleReason ?? "No es posible completar el viaje con el margen actual."}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {plan.stops.map((st, i) => (
        <li key={st.charger.id} className="rounded-lg bg-bg-elevated px-3 py-2.5 text-sm leading-relaxed text-muted">
          <span className="font-medium text-fg">
            {i + 1}. {st.charger.name}
          </span>
          {" · "}llegas al {formatPct(st.arriveSoc)}, carga a {formatPct(st.departSoc)} ({formatKwh(st.energyAddedKwh)},{" "}
          {formatMinutes(st.chargeMinutes)}). Siguiente tramo {formatKm(st.kmToNext)}
          {st.fromRouteKm > 0.15 ? ` · desvío ${formatKm(st.fromRouteKm, 1)}` : ""}.
        </li>
      ))}
    </ul>
  );
}
