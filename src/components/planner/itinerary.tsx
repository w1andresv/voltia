import { Flag, MapPin, Navigation } from "lucide-react";
import type { ItineraryNode, RoutePlan } from "@/domain/types";
import { CHARGER_SOURCE_LABEL, CONNECTOR_LABEL } from "@/domain/types";
import { formatKm, formatKwh, formatKw, formatMinutes, formatPct, formatUpdatedAt } from "@/lib/format";

export function Itinerary({ plan }: { plan: RoutePlan }) {
  let stopN = 0;
  return (
    <ol className="relative space-y-0">
      {plan.itinerary.map((node, i) => {
        const n = node.kind === "charger" ? ++stopN : 0;
        return (
          <li key={`${node.kind}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {i < plan.itinerary.length - 1 ? (
              <span className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-border" />
            ) : null}
            <NodeIcon node={node} n={n} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">
                    {node.kind === "charger" ? `${n} — ${node.label}` : node.label}
                  </div>
                  <div className="text-xs text-muted">
                    {node.kind === "origin"
                      ? "Salida"
                      : node.kind === "destination"
                        ? "Destino"
                        : "Electrolinera verificada"}
                    {" · "}
                    {formatKm(node.km, node.km < 10 ? 1 : 0)}
                  </div>
                </div>
                <div className="font-mono text-sm tabular-nums text-accent">{formatPct(node.soc)}</div>
              </div>
              {node.charge ? <StopFacts stop={node.charge} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StopFacts({ stop }: { stop: NonNullable<ItineraryNode["charge"]> }) {
  const c = stop.charger;
  const coords = `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-bg-elevated px-3 py-2 text-xs text-muted">
      <div className="flex justify-between text-fg">
        <span>
          Cargar {formatPct(stop.arriveSoc)} → {formatPct(stop.departSoc)}
        </span>
        <span className="font-mono tabular-nums">{formatMinutes(stop.chargeMinutes)}</span>
      </div>
      <div>
        {formatKwh(stop.energyAddedKwh)} · {CONNECTOR_LABEL[stop.bestSocket.connector]} · {formatKw(stop.chargeKw)}
      </div>
      <div>{c.operator || "Operador no indicado"}</div>
      {c.address ? <div>{c.address}</div> : null}
      <div>Coordenadas {coords}</div>
      <div>
        Fuente {CHARGER_SOURCE_LABEL[c.source]} · Actualización {formatUpdatedAt(c.updatedAt)}
      </div>
      {stop.fromRouteKm > 0.15 ? (
        <div>
          {formatKm(stop.fromRouteKm, 1)} desde la ruta · desvío {formatKm(stop.detourKm, 1)}
          {stop.detourMinutes >= 1 ? ` · +${formatMinutes(stop.detourMinutes)}` : ""}
        </div>
      ) : (
        <div>Sobre la ruta</div>
      )}
      {stop.kmToNext > 0 ? (
        <div>
          Siguiente: {stop.nextLabel || "destino"} en {formatKm(stop.kmToNext, stop.kmToNext < 10 ? 1 : 0)}
        </div>
      ) : null}
    </div>
  );
}

function NodeIcon({ node, n }: { node: ItineraryNode; n: number }) {
  const wrap = "relative z-[1] grid size-8 shrink-0 place-items-center rounded-full";
  if (node.kind === "origin") {
    return (
      <span className={`${wrap} bg-fg text-bg`}>
        <MapPin className="size-3.5" />
      </span>
    );
  }
  if (node.kind === "destination") {
    return (
      <span className={`${wrap} bg-accent text-accent-fg`}>
        <Flag className="size-3.5" />
      </span>
    );
  }
  if (node.kind === "charger") {
    return (
      <span className={`${wrap} bg-accent text-sm font-semibold text-accent-fg`}>{n}</span>
    );
  }
  return (
    <span className={`${wrap} bg-surface-2 text-muted`}>
      <Navigation className="size-3.5" />
    </span>
  );
}