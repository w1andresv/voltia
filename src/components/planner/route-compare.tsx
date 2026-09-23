import type { RoutePlan } from "@/lib/domain/types";
import { formatKm, formatMinutes, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";

export function RouteCompare({ plans }: { plans: RoutePlan[] }) {
  const selected = usePlanner((s) => s.selectedPlanId);
  const select = usePlanner((s) => s.selectPlan);
  if (plans.length < 2) return null;
  return (
    <div className="grid gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Comparar rutas</h3>
      {plans.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => select(p.id)}
          className={cn(
            "rounded-lg px-3 py-2.5 text-left",
            selected === p.id ? "bg-accent/15" : "bg-bg-elevated hover:bg-surface-2",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{p.label}</span>
            <span className="font-mono text-xs tabular-nums text-muted">{formatPct(p.arrivalSoc)}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatKm(p.distanceKm)} · {formatMinutes(p.totalMinutes)} · {p.stops.length}{" "}
            {p.stops.length === 1 ? "parada" : "paradas"}
            {p.chargeMinutes > 0 ? ` · ${formatMinutes(p.chargeMinutes)} carga` : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
