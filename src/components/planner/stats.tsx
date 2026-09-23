import type { ReactNode } from "react";
import { Mountain, Timer, Zap } from "lucide-react";
import type { RoutePlan } from "@/domain/types";
import { formatElevation, formatKm, formatKwh, formatKwhPer100, formatMinutes, formatPct } from "@/lib/format";

export function PlanStats({ plan }: { plan: RoutePlan }) {
  const next = plan.stops[0];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Distancia" value={formatKm(plan.distanceKm)} />
        <Stat label="Tiempo total" value={formatMinutes(plan.totalMinutes)} />
        <Stat
          label="Consumo neto"
          value={formatKwh(plan.energyKwh, true)}
          hint={formatKwhPer100(plan.avgKwhPer100km)}
        />
        <Stat
          label="Llegada"
          value={formatPct(plan.arrivalSoc)}
          tone={plan.arrivalSoc < plan.safetyPct ? "danger" : plan.arrivalSoc < plan.safetyPct + 8 ? "warn" : "ok"}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Bruto" value={formatKwh(plan.energyGrossKwh)} />
        <Mini label="Regen" value={formatKwh(plan.energyRegenKwh)} />
        <Mini label="Neto" value={formatKwh(plan.energyKwh)} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        El consumo neto alimenta el SOC, las paradas y el promedio acumulado. Subidas (+
        {formatElevation(plan.elevation.gainM)}) suben el gasto; bajadas (−{formatElevation(plan.elevation.lossM)})
        recuperan parte con regeneración. Las recargas solo ocurren en electrolineras reales y verificadas de la ruta.
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini icon={<Timer className="size-3.5" />} label="Conducción" value={formatMinutes(plan.driveMinutes)} />
        <Mini icon={<Zap className="size-3.5" />} label="Carga" value={formatMinutes(plan.chargeMinutes)} />
        <Mini
          icon={<Mountain className="size-3.5" />}
          label="Desnivel +"
          value={formatElevation(plan.elevation.gainM)}
        />
      </div>

      {plan.canArriveWithoutCharge ? (
        <div className="rounded-lg bg-ok/10 px-3 py-2 text-xs text-ok">
          Llegas sin recargar. Restan {formatKwh(plan.remainingKwh)} · margen {formatPct(plan.safetyMarginPct)}.
        </div>
      ) : next ? (
        <div className="rounded-lg bg-bg-elevated px-3 py-2 text-xs text-muted">
          Próxima carga {formatPct(next.arriveSoc)} → {formatPct(next.departSoc)} · {formatMinutes(next.chargeMinutes)}
        </div>
      ) : !plan.feasible ? (
        <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {plan.infeasibleReason ?? "No es posible completar el viaje con el margen actual."}
        </div>
      ) : null}
    </div>
  );
}

export function PlanPeek({ plan }: { plan: RoutePlan }) {
  const next = plan.stops[0];
  return (
    <div className="px-4 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-sm tabular-nums text-fg">
          {formatKm(plan.distanceKm)} · {formatMinutes(plan.totalMinutes)} · {formatPct(plan.arrivalSoc)}
        </p>
        <p className="font-mono text-xs tabular-nums text-muted">{formatKwhPer100(plan.avgKwhPer100km)}</p>
      </div>
      <p className="mt-1 truncate text-xs text-muted">
        {plan.canArriveWithoutCharge
          ? `Sin recarga · restan ${formatKwh(plan.remainingKwh)}`
          : next
            ? `Próxima carga ${formatPct(next.arriveSoc)} → ${formatPct(next.departSoc)} · ${formatMinutes(next.chargeMinutes)}`
            : plan.infeasibleReason ?? "Revisa margen o cargadores"}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className="rounded-lg bg-bg-elevated px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-base tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 font-mono text-xs tabular-nums text-subtle">{hint}</div> : null}
    </div>
  );
}

function Mini({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elevated px-2 py-2">
      <div className="flex items-center justify-center gap-1 text-muted">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 font-mono text-xs tabular-nums text-fg">{value}</div>
    </div>
  );
}
