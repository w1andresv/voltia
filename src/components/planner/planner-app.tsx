"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Battery, Map as MapIcon } from "lucide-react";
import { usePlanner } from "@/lib/store";
import { formatKm, formatPct } from "@/lib/format";
import { MapPane } from "@/components/map/map-pane";
import { StationHub } from "./station-hub";
import { TripResults, TripSetup } from "./trip-panel";

function useWide() {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}

export function PlannerApp() {
  const plan = usePlanner((s) => s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0] ?? null);
  const hoverKm = usePlanner((s) => s.hoverKm);
  const armed = usePlanner((s) => s.mapClickArmed);
  const [mapOffscreen, setMapOffscreen] = useState(false);
  const wide = useWide();

  useEffect(() => {
    const slot = document.getElementById("voltia-map-slot");
    const root = document.getElementById("voltia-scroll");
    if (!slot || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setMapOffscreen(!entry?.isIntersecting),
      { root, threshold: 0.2 },
    );
    io.observe(slot);
    return () => io.disconnect();
  }, [plan?.id]);

  const hoverSample =
    plan && hoverKm != null
      ? plan.samples.reduce((b, s) => (Math.abs(s.km - hoverKm) < Math.abs(b.km - hoverKm) ? s : b))
      : null;

  return (
    <div
      id="voltia-scroll"
      className="relative z-20 h-dvh overflow-y-auto overscroll-y-contain pt-14 md:flex md:overflow-hidden"
    >
      {armed ? (
        <div className="pointer-events-none sticky top-16 z-10 mx-4 mt-2 w-fit rounded-lg bg-surface px-3 py-2 text-sm shadow-float md:absolute md:right-4 md:top-4">
          Toca el mapa para{" "}
          {armed === "origin"
            ? "el origen"
            : armed === "waypoint"
              ? "una parada"
              : armed === "station"
                ? "la electrolinera"
                : "el destino"}
        </div>
      ) : null}

      {hoverSample ? (
        <div className="pointer-events-none absolute right-4 top-4 z-10 hidden rounded-lg bg-surface px-3 py-2 shadow-float md:block">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Battery className="size-3.5 text-accent" />
            <span className="font-mono tabular-nums text-fg">
              {formatKm(hoverSample.km, 1)} · {formatPct(hoverSample.soc)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="border-border bg-surface md:flex md:h-full md:w-[580px] md:shrink-0 md:flex-col md:overflow-y-auto md:border-r">
        <div
          id="voltia-map-slot"
          className="relative h-[46vh] min-h-64 shrink-0 overflow-hidden bg-bg md:hidden"
        >
          {!wide ? <MapPane mode="plan" /> : null}
        </div>
        <TripSetup />
        {plan ? <TripResults plan={plan} /> : <div className="h-8 md:hidden" />}
      </div>

      <div id="voltia-map-slot-lg" className="relative hidden h-full min-h-0 flex-1 md:block">
        {wide ? <MapPane mode="plan" /> : null}
      </div>

      {mapOffscreen && plan ? (
        <button
          type="button"
          className="pointer-events-auto fixed bottom-5 right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg shadow-float md:hidden"
          onClick={() =>
            document.getElementById("voltia-map-slot")?.scrollIntoView({ behavior: "smooth", block: "center" })
          }
        >
          <MapIcon className="size-4" />
          Mapa
        </button>
      ) : null}

      <div className="pointer-events-auto">
        <StationHub />
      </div>
    </div>
  );
}
