import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MapPinned, Route as RouteIcon, Zap } from "lucide-react";
import { useChargerNetwork } from "@/components/planner/use-charger-network";
import { usePlanner } from "@/lib/store";

export function HomeMenu() {
  const chargers = useChargerNetwork();
  const hasMapbox = usePlanner((s) => Boolean(s.mapboxToken));
  const setMapboxToken = usePlanner((s) => s.setMapboxToken);

  return (
    <div className="pointer-events-none relative z-20 flex h-dvh w-full flex-col overflow-hidden px-5 py-8 md:px-12 md:py-12">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/35 via-bg/50 to-bg/85" />

      <header className="pointer-events-auto relative max-w-lg">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-fg">
            <Zap className="size-5" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">Voltia</h1>
            <p className="text-sm text-muted">Red de carga y planificación energética</p>
          </div>
        </div>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted" suppressHydrationWarning>
          {chargers.length} electrolineras públicas en la misma red para planificar y aportar.
        </p>
        {hasMapbox ? (
          <button
            type="button"
            className="mt-3 min-h-11 text-sm text-subtle underline-offset-2 hover:text-muted hover:underline"
            onClick={() => setMapboxToken("")}
          >
            Cambiar token de Mapbox
          </button>
        ) : null}
      </header>

      <div className="pointer-events-auto relative mt-auto grid w-full max-w-2xl gap-3 pb-4 md:grid-cols-2">
        <MenuCard
          to="/planificar"
          icon={<RouteIcon className="size-5" />}
          title="Planificar ruta"
          hint="Mapa interactivo con toda la red. Elige origen y destino; toca un cargador para sumarlo al viaje."
        />
        <MenuCard
          to="/electrolineras"
          icon={<MapPinned className="size-5" />}
          title="Electrolineras"
          hint="Consulta toda la red sobre el mapa. El botón + registra una estación que el planificador también usa."
        />
      </div>
    </div>
  );
}

function MenuCard({
  to,
  icon,
  title,
  hint,
}: {
  to: "/planificar" | "/electrolineras";
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-40 flex-col rounded-2xl bg-surface p-5 shadow-panel outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">{icon}</span>
      <span className="mt-4 text-lg font-semibold tracking-tight text-fg">{title}</span>
      <span className="mt-1 text-sm leading-relaxed text-muted">{hint}</span>
    </Link>
  );
}
