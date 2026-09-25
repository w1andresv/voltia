import { Check, TriangleAlert } from "lucide-react";
import { formatRoadMix } from "@/domain/road-hierarchy";
import { HIGHLIGHT_LABEL, routeHighlights } from "@/domain/route-highlights";
import { CONNECTOR_LABEL, type RoutePlan } from "@/domain/types";
import { isDc } from "@/domain/charging";
import { formatKm, formatKw, formatKwh, formatMinutes, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";

/** "+18 min · +12 km" respecto de la ruta más rápida (vacío si es ella o la diferencia no se nota). */
function deltaText(plan: RoutePlan, reference: RoutePlan): string {
  if (plan.id === reference.id) return "";
  const parts: string[] = [];
  const dMin = plan.totalMinutes - reference.totalMinutes;
  const dKm = plan.distanceKm - reference.distanceKm;
  if (Math.abs(dMin) >= 1) parts.push(`${dMin > 0 ? "+" : "−"}${formatMinutes(Math.abs(dMin))}`);
  if (Math.abs(dKm) >= 1) parts.push(`${dKm > 0 ? "+" : "−"}${formatKm(Math.abs(dKm))}`);
  return parts.length ? `${parts.join(" · ")} vs. la más rápida` : "";
}

/**
 * Rutas encontradas al planificar: cada una con sus cifras, etiquetas (más rápida,
 * más corta, sin peajes…) y diferencia frente a la más rápida. Elegir una la
 * dibuja en el mapa (las demás quedan en gris y también se pueden tocar ahí).
 */
export function RouteCompare({ plans }: { plans: RoutePlan[] }) {
  const selected = usePlanner((s) => s.selectedPlanId);
  const select = usePlanner((s) => s.selectPlan);
  if (plans.length < 2) return null;

  const highlights = routeHighlights(plans);
  const candidates = plans.filter((p) => p.feasible);
  const fastest = [...(candidates.length ? candidates : plans)].sort(
    (a, b) => a.totalMinutes - b.totalMinutes,
  )[0]!;

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">
          {plans.length} rutas encontradas
        </h2>
        <span className="text-xs text-subtle">Toca una para verla en el mapa</span>
      </div>
      <div role="radiogroup" aria-label="Rutas encontradas" className="grid gap-2">
        {plans.map((p) => {
          const active = selected === p.id;
          const tags = highlights.get(p.id) ?? [];
          const delta = deltaText(p, fastest);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(p.id)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-accent/60 bg-accent/15"
                  : "border-transparent bg-bg-elevated hover:bg-surface-2",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{p.label}</span>
                    {active ? (
                      <span className="inline-flex items-center gap-0.5 text-xs text-accent">
                        <Check className="size-3.5" /> En el mapa
                      </span>
                    ) : null}
                  </div>
                  {p.via ? <div className="truncate text-xs text-muted">Por {p.via}</div> : null}
                </div>
                <span
                  className="shrink-0 font-mono text-xs tabular-nums text-muted"
                  title="Batería al llegar"
                >
                  {formatPct(p.arrivalSoc)}
                </span>
              </div>

              {tags.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-fg"
                    >
                      {HIGHLIGHT_LABEL[t]}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-1.5 text-xs text-muted">
                {formatKm(p.distanceKm)} · {formatMinutes(p.totalMinutes)} · {p.stops.length}{" "}
                {p.stops.length === 1 ? "parada" : "paradas"}
                {p.chargeMinutes > 0 ? ` · ${formatMinutes(p.chargeMinutes)} carga` : ""}
              </div>
              {p.roadMix && formatRoadMix(p.roadMix) ? (
                <div className="mt-0.5 text-xs text-subtle">Vías: {formatRoadMix(p.roadMix)}</div>
              ) : null}
              {delta ? <div className="mt-0.5 text-xs text-subtle">{delta}</div> : null}
              {p.stops[0] ? (
                <div className="mt-1 space-y-0.5 text-xs text-fg">
                  <div>
                    {p.stops[0].adapter
                      ? `Necesario adaptador para carga rápida (${CONNECTOR_LABEL[p.stops[0].adapter.from]} → ${CONNECTOR_LABEL[p.stops[0].adapter.to]}) · `
                      : !isDc(p.stops[0].bestSocket.connector)
                        ? "Carga lenta — sin adaptador · "
                        : ""}
                    {p.stops[0].charger.name}: {formatPct(p.stops[0].arriveSoc)} →{" "}
                    {formatPct(p.stops[0].departSoc)} · {formatKwh(p.stops[0].energyAddedKwh)} ·{" "}
                    {formatMinutes(p.stops[0].chargeMinutes)} · {formatKw(p.stops[0].chargeKw)}
                  </div>
                  {p.stops[0].options && p.stops[0].options.length > 1
                    ? p.stops[0].options.slice(1).map((option, n) => (
                        <div key={`${option.socket.connector}-${n}`} className="text-warn">
                          {option.mode === "adapter" && option.adapter
                            ? `${CONNECTOR_LABEL[option.adapter.from]} → ${CONNECTOR_LABEL[option.adapter.to]} — ${formatKw(option.nominalKw)} — con adaptador`
                            : option.mode === "ac"
                              ? `Carga lenta — sin adaptador · ${formatKw(option.chargeKw)}`
                              : `Carga directa · ${CONNECTOR_LABEL[option.socket.connector]}`}
                          {" · "}
                          {formatMinutes(option.chargeMinutes)}
                          {option.reachesNext ? " · sigue al siguiente punto" : ""}
                        </div>
                      ))
                    : null}
                </div>
              ) : !p.feasible ? (
                <div className="mt-1 flex items-center gap-1 text-xs text-warn">
                  <TriangleAlert className="size-3.5" /> No se puede completar con la batería y
                  cargadores disponibles
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
