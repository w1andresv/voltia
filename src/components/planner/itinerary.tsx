import { Flag, MapPin, Navigation } from "lucide-react";
import { isDc } from "@/domain/charging";
import type { ChargeStop, ItineraryNode, RoutePlan } from "@/domain/types";
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

function optionTitle(stop: ChargeStop, index: number): string {
  const option = stop.options?.[index];
  if (!option) return "";
  if (option.mode === "adapter" && option.adapter) {
    return `Carga rápida con adaptador · ${CONNECTOR_LABEL[option.adapter.from]} → ${CONNECTOR_LABEL[option.adapter.to]}`;
  }
  if (option.mode === "ac") return `Carga lenta — sin adaptador · ${CONNECTOR_LABEL[option.socket.connector]}`;
  return `Carga directa · ${CONNECTOR_LABEL[option.socket.connector]}`;
}

function ChargeLines({ stop }: { stop: ChargeStop }) {
  if (stop.options && stop.options.length > 1) {
    return (
      <div className="space-y-2">
        {stop.options.map((option, i) => (
          <div key={`${option.socket.connector}-${i}`} className={i > 0 ? "border-t border-border pt-2" : ""}>
            <div className={i === 0 ? "font-medium text-fg" : "font-medium text-warn"}>{optionTitle(stop, i)}</div>
            <div>
              Estación {CONNECTOR_LABEL[option.socket.connector]}
              {option.adapter ? ` · vehículo ${CONNECTOR_LABEL[option.adapter.to]}` : ""}
              {option.adapter ? ` · adaptador ${CONNECTOR_LABEL[option.adapter.from]} → ${CONNECTOR_LABEL[option.adapter.to]}` : ""}
            </div>
            <div>
              Nominal {formatKw(option.nominalKw)} · aprovechable {formatKw(option.chargeKw)}
            </div>
            <div>
              Llegas al {formatPct(option.arriveSoc)} · mínimo {formatPct(option.minDepartSoc)} · sales al{" "}
              {formatPct(option.departSoc)}
            </div>
            <div>
              {formatKwh(option.energyAddedKwh)} · {formatMinutes(option.chargeMinutes)} · alcance{" "}
              {formatKm(option.rangeGainKm)}
              {option.reachesNext ? " · sigue al siguiente punto" : " · no cubre el siguiente tramo"}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const slow = !stop.adapter && !isDc(stop.bestSocket.connector);
  return (
    <div className="space-y-1">
      {stop.adapter ? (
        <div className="font-medium text-warn">
          Carga rápida con adaptador · {CONNECTOR_LABEL[stop.adapter.from]} → {CONNECTOR_LABEL[stop.adapter.to]}
        </div>
      ) : slow ? (
        <div className="font-medium text-warn">Carga lenta — sin adaptador</div>
      ) : null}
      <div>
        Llegas al {formatPct(stop.arriveSoc)} · mínimo {formatPct(stop.minDepartSoc)} · sales al{" "}
        {formatPct(stop.departSoc)}
      </div>
      <div>
        {formatKwh(stop.energyAddedKwh)} · {formatKw(stop.chargeKw)} · {formatMinutes(stop.chargeMinutes)} ·
        alcance {formatKm(stop.rangeGainKm)}
      </div>
    </div>
  );
}

function StopFacts({ stop }: { stop: NonNullable<ItineraryNode["charge"]> }) {
  const c = stop.charger;
  const coords = `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-bg-elevated px-3 py-2 text-xs text-muted">
      <ChargeLines stop={stop} />
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