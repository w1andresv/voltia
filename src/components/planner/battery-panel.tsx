import { chargeCurveSeries, chargeTimeMinutes } from "@/lib/domain/charging";
import { batteryBudget } from "@/lib/domain/energy";
import { safetyPct } from "@/lib/domain/types";
import { vehicleLabel } from "@/lib/domain/vehicles";
import { formatKm, formatKw, formatKwh, formatKwhPer100, formatMinutes, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const START_PRESETS = [50, 70, 80, 90, 100];
const ARRIVE_PRESETS = [10, 15, 20, 30];

export function BatteryDialog() {
  const open = usePlanner((s) => s.batteryOpen);
  const setOpen = usePlanner((s) => s.setBatteryOpen);
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const conditions = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const weather = usePlanner((s) => s.geo?.weather ?? null);
  const plan = usePlanner((s) => s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0] ?? null);

  const floor = safetyPct(conditions);
  const budget = batteryBudget(vehicle, conditions, weather);
  const to80 = chargeTimeMinutes(vehicle.batteryKwh, 10, 80, vehicle.dcMaxKw, vehicle.dcMaxKw, vehicle.chargeCurve);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gestión de batería</DialogTitle>
          <DialogDescription>
            {vehicleLabel(vehicle)} · {formatKwh(vehicle.batteryKwh)} · ventana de viaje {vehicle.minSocRecommended}–
            {vehicle.maxSocTravel}%
          </DialogDescription>
        </DialogHeader>

        <BatteryPack soc={conditions.initialSoc} floor={budget.floorPct} maxTravel={vehicle.maxSocTravel} />
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>Reserva {formatPct(budget.floorPct)}</span>
          <span>Tope en ruta {formatPct(vehicle.maxSocTravel)}</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="Usable" value={formatKwh(budget.usableKwh)} hint={`${Math.round(budget.usablePct)} %`} />
          <Metric
            label="Estimada"
            value={formatKm(budget.rangeKm)}
            hint={budget.energyMode === "manual" ? "con tu ficha" : "peso, ruta y clima"}
          />
          <Metric label="En pack" value={formatKwh(budget.packedKwh)} hint={formatPct(conditions.initialSoc)} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {budget.energyMode === "manual" ? "Consumo de ficha" : "Consumo estimado"} {formatKwhPer100(budget.per100)}.
          Autonomía WLTP {formatKm(budget.wltpKm)}
          {budget.wltpKwhPer100 ? ` · implica ${formatKwhPer100(budget.wltpKwhPer100)}` : ""} — homologada, no es la de
          cada viaje.
        </p>

        <section className="mt-5 space-y-4">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Salida</Label>
              <span className="font-mono text-xs tabular-nums text-muted">
                {formatPct(conditions.initialSoc)} · {formatKwh((conditions.initialSoc / 100) * vehicle.batteryKwh)}
              </span>
            </div>
            <Slider
              min={5}
              max={100}
              step={1}
              value={[conditions.initialSoc]}
              onValueChange={([v]) => patch({ initialSoc: v ?? 80 })}
            />
            <PresetRow
              values={START_PRESETS}
              current={conditions.initialSoc}
              onPick={(v) => patch({ initialSoc: v })}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Llegada mínima</Label>
              <span className="font-mono text-xs tabular-nums text-muted">
                {formatPct(conditions.arrivalSoc)} · {formatKwh((conditions.arrivalSoc / 100) * vehicle.batteryKwh)}
              </span>
            </div>
            <Slider
              min={5}
              max={50}
              step={1}
              value={[conditions.arrivalSoc]}
              onValueChange={([v]) => patch({ arrivalSoc: v ?? 20 })}
            />
            <PresetRow
              values={ARRIVE_PRESETS}
              current={conditions.arrivalSoc}
              onPick={(v) => patch({ arrivalSoc: v })}
            />
          </div>
        </section>

        {conditions.initialSoc < budget.floorPct ? (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            Sales por debajo de la reserva. El planificador exigirá cargar antes o marcará el viaje como inviable.
          </p>
        ) : null}

        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Curva de carga DC</h3>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              pico {formatKw(vehicle.dcMaxKw)} · 10→80 {formatMinutes(to80)}
            </span>
          </div>
          <ChargeCurve vehicleKw={vehicle.dcMaxKw} />
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            La potencia cae al subir el SOC. Por eso el planificador suele recargar hasta {vehicle.maxSocTravel}% y no
            hasta 100%.
          </p>
        </section>

        {plan ? (
          <section className="mt-5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">En este viaje</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Metric
                label={plan.energyMode === "manual" ? "Consumo ficha" : "Consumo estimado"}
                value={formatKwh(plan.energyKwh, true)}
                hint={formatKwhPer100(plan.avgKwhPer100km)}
              />
              <Metric
                label="Llegada"
                value={formatPct(plan.arrivalSoc)}
                hint={plan.feasible ? "objetivo cubierto" : "bajo el margen"}
                tone={plan.arrivalSoc < floor ? "danger" : "ok"}
              />
              <Metric label="Paradas" value={String(plan.stops.length)} />
              <Metric label="SOC mínimo" value={formatPct(plan.minSoc)} />
            </div>
            {plan.canArriveWithoutCharge ? (
              <p className="mt-2 text-xs text-ok">Llegas sin recargar. Margen {formatPct(plan.safetyMarginPct)}.</p>
            ) : plan.feasible ? (
              <p className="mt-2 text-xs text-muted">
                {plan.stops.length === 1 ? "Una parada de carga" : `${plan.stops.length} paradas`} ·{" "}
                {formatMinutes(plan.chargeMinutes)} enchufado
              </p>
            ) : (
              <p className="mt-2 text-xs text-danger">{plan.infeasibleReason ?? "No es viable con este SOC."}</p>
            )}
          </section>
        ) : (
          <p className="mt-5 text-xs leading-relaxed text-muted">
            Ajusta salida y llegada, luego planifica una ruta. El modelo recalcula autonomía, paradas y tiempos al
            momento.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PresetRow({
  values,
  current,
  onPick,
}: {
  values: number[];
  current: number;
  onPick: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant={current === v ? "default" : "secondary"}
          onClick={() => onPick(v)}
        >
          {v}%
        </Button>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "danger";
}) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className="rounded-md bg-bg-elevated px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-sm tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="text-[11px] text-subtle">{hint}</div> : null}
    </div>
  );
}

export function BatteryPack({
  soc,
  floor,
  maxTravel,
  cells = 10,
  compact = false,
}: {
  soc: number;
  floor: number;
  maxTravel: number;
  cells?: number;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center", compact ? "gap-0.5" : "gap-1")}>
      <div
        className={cn(
          "flex flex-1 items-stretch rounded-md bg-bg p-1",
          compact && "rounded-sm bg-transparent p-0",
        )}
      >
        {Array.from({ length: cells }, (_, i) => {
          const lo = (i / cells) * 100;
          const hi = ((i + 1) / cells) * 100;
          const filled = soc >= hi - 100 / cells / 2;
          const reserve = hi <= floor + 0.5;
          const overCap = lo >= maxTravel - 0.5;
          return (
            <span
              key={i}
              className={cn(
                "min-w-0 flex-1 rounded-sm",
                compact ? "h-1.5" : "h-7",
                filled && reserve && "bg-warn",
                filled && !reserve && !overCap && "bg-accent",
                filled && overCap && "bg-accent/45",
                !filled && "bg-surface-2",
              )}
            />
          );
        })}
      </div>
      <span className={cn("shrink-0 rounded-r-sm bg-muted/50", compact ? "h-2 w-0.5" : "h-4 w-1")} />
    </div>
  );
}

function ChargeCurve({ vehicleKw }: { vehicleKw: number }) {
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const series = chargeCurveSeries(vehicle, 4);
  const maxKw = Math.max(vehicleKw, 1);
  const w = 280;
  const h = 88;
  const pad = { l: 4, r: 4, t: 6, b: 4 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xy = (soc: number, kw: number) => [
    pad.l + (soc / 100) * innerW,
    pad.t + innerH - (kw / maxKw) * innerH,
  ] as const;
  const d = series
    .map((p, i) => {
      const [x, y] = xy(p.soc, p.kw);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const last = xy(100, series[series.length - 1]?.kw ?? 0);
  const first = xy(0, series[0]?.kw ?? 0);
  const area = `${d} L${last[0].toFixed(1)} ${pad.t + innerH} L${first[0].toFixed(1)} ${pad.t + innerH} Z`;
  const p80 = xy(80, series.find((p) => p.soc === 80)?.kw ?? maxKw * 0.4);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full text-accent" role="img" aria-label="Curva de carga DC">
      <line x1={pad.l} x2={w - pad.r} y1={p80[1]} y2={p80[1]} stroke="currentColor" strokeOpacity={0.15} />
      <line x1={p80[0]} x2={p80[0]} y1={pad.t} y2={pad.t + innerH} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="3 3" />
      <path d={area} fill="currentColor" fillOpacity={0.16} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <text x={p80[0] + 4} y={pad.t + 10} fill="var(--color-muted)" fontSize="9">
        80%
      </text>
    </svg>
  );
}
