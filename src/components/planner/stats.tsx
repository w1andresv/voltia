import { useMemo, type ReactNode } from "react";
import { Mountain, Timer, Zap } from "lucide-react";
import { consumptionBlocks } from "@/domain/energy";
import { ROUTING_ENGINE_LABEL, type RoutePlan } from "@/domain/types";
import { formatElevation, formatKm, formatKwh, formatKwhPer100, formatMinutes, formatPct } from "@/lib/format";

export function PlanStats({ plan }: { plan: RoutePlan }) {
  const next = plan.stops[0];
  const engineHint = plan.engine ? ROUTING_ENGINE_LABEL[plan.engine] : undefined;
  const detourHint = plan.detourKm >= 0.5 ? `+${formatKm(plan.detourKm, 1)} de desvío a cargadores` : undefined;
  const distanceHint = [detourHint, engineHint].filter(Boolean).join(" · ") || undefined;
  const chargeKwh = plan.stops.reduce((sum, stop) => sum + stop.energyAddedKwh, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Distancia" value={formatKm(plan.distanceKm)} hint={distanceHint} />
        <Stat label="Tiempo total" value={formatMinutes(plan.totalMinutes)} />
        <Stat label="Consumo neto" value={formatKwh(plan.energyKwh, true)} />
        <Stat
          label="Consumo /100 km"
          value={formatKwh(plan.avgKwhPer100km, true)}
          hint="Promedio estimado de la ruta"
        />
        <Stat
          label="Batería inicial"
          value={formatPct(plan.initialSoc)}
          hint={
            plan.departureCharge
              ? `incluye ${plan.departureCharge.additionalPct}% antes de salir`
              : undefined
          }
        />
        <Stat
          label="Llegada"
          value={formatPct(plan.arrivalSoc)}
          tone={plan.arrivalSoc < plan.safetyPct ? "danger" : plan.arrivalSoc < plan.safetyPct + 8 ? "warn" : "ok"}
        />
        <Stat label="Paradas" value={String(plan.stops.length)} />
        <Stat label="Tiempo de carga" value={formatMinutes(plan.chargeMinutes)} />
        <Stat label="Energía a cargar" value={formatKwh(chargeKwh)} className="col-span-2" />
      </div>

      <ConsumptionByBlock plan={plan} />

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

/**
 * Consumo estimado por cada 100 km de ruta. Un tramo final corto se suma al
 * anterior. Resalta los tramos bastante por encima o por debajo del promedio.
 */
function ConsumptionByBlock({ plan }: { plan: RoutePlan }) {
  const blocks = useMemo(() => consumptionBlocks(plan.samples), [plan.samples]);
  if (blocks.length < 2) return null;
  const max = Math.max(1, ...blocks.map((b) => b.kwhPer100));
  const avg = plan.avgKwhPer100km;
  return (
    <section className="rounded-md border border-border bg-bg-elevated px-3 py-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-subtle">Consumo cada 100 km</h3>
      <ul className="mt-2 space-y-2.5">
        {blocks.map((b) => {
          const high = b.kwhPer100 > avg * 1.15;
          const low = b.kwhPer100 < avg * 0.85;
          const width = Math.max(2, (Math.max(0, b.kwhPer100) / max) * 100);
          return (
            <li key={b.fromKm} className="text-xs">
              <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2">
                <span className="font-mono tabular-nums text-muted">
                  {Math.round(b.fromKm)}–{formatKm(b.toKm)}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${high ? "bg-warn" : low ? "bg-ok" : "bg-accent"}`}
                    style={{ width: `${width}%` }}
                  />
                </span>
                <span className={`font-mono tabular-nums ${high ? "text-warn" : "text-fg"}`}>
                  {formatKwhPer100(b.kwhPer100)}
                </span>
              </div>
              <div className="mt-0.5 pl-[7rem] font-mono tabular-nums text-subtle">
                {formatKwh(b.kwh)} · ↑ {formatElevation(b.gainM)} · ↓ {formatElevation(b.lossM)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
  className = "",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "danger";
  className?: string;
}) {
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className={`rounded-md border border-border bg-bg-elevated px-3 py-2.5 ${className}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`mt-1 font-mono text-lg font-medium tabular-nums tracking-tight ${color}`}>{value}</div>
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
