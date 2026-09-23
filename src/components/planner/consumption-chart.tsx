import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RoutePlan, RouteSample } from "@/lib/domain/types";
import { formatKm, formatKwhPer100 } from "@/lib/format";
import { usePlanner } from "@/lib/store";

const LINE = "#d6b07e";

function seriesFrom(samples: RouteSample[]) {
  return samples.map((s) => ({
    km: Number(s.km.toFixed(1)),
    avg: s.km > 0.3 ? Math.round(s.avgKwhPer100 * 10) / 10 : null as number | null,
  }));
}

export function ConsumptionChart({ plan }: { plan: RoutePlan }) {
  const setHover = usePlanner((s) => s.setHoverKm);
  const hoverKm = usePlanner((s) => s.hoverKm);
  const regenPct = usePlanner((s) => s.conditions.regenPct);

  const data = useMemo(() => seriesFrom(plan.samples), [plan.samples]);
  const rates = data.map((d) => d.avg).filter((n): n is number => n != null && n > 0);
  const peak = rates.length ? Math.max(...rates) : plan.avgKwhPer100km;
  const floor = rates.length ? Math.min(...rates) : 0;
  const mean = plan.avgKwhPer100km;
  const hover =
    hoverKm == null
      ? null
      : data.reduce((b, s) => (Math.abs(s.km - hoverKm) < Math.abs(b.km - hoverKm) ? s : b));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Consumo promedio acumulado</h3>
        <span className="font-mono text-xs tabular-nums text-muted">{formatKwhPer100(mean)}</span>
      </div>
      <p className="mb-1.5 text-xs text-muted">
        Energía neta / distancia hasta cada km. Subidas lo suben; la regeneración en bajadas lo baja.
        Regen {regenPct}%.
      </p>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              const label = (state as { activeLabel?: number }).activeLabel;
              if (typeof label === "number") setHover(label);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="avgFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity={0.4} />
                <stop offset="100%" stopColor={LINE} stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(238 242 246 / 0.08)" />
            <XAxis dataKey="km" tick={{ fill: "#8b98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              width={40}
              domain={[Math.max(0, Math.floor(floor * 0.85)), Math.max(12, Math.ceil(peak * 1.12))]}
              tick={{ fill: "#8b98a8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as { km: number; avg: number | null };
                if (d.avg == null) return null;
                return (
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs shadow-float">
                    <div>
                      {formatKm(d.km, 1)} · {formatKwhPer100(d.avg)}
                    </div>
                    <div className="text-muted">Promedio acumulado neto</div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={mean} stroke="rgb(238 242 246 / 0.28)" strokeDasharray="4 4" />
            {hoverKm != null ? (
              <ReferenceLine x={Number(hoverKm.toFixed(1))} stroke="rgb(238 242 246 / 0.35)" />
            ) : null}
            <Area
              type="monotone"
              dataKey="avg"
              stroke={LINE}
              strokeWidth={1.8}
              fill="url(#avgFill)"
              connectNulls
              isAnimationActive={false}
            />
            {hover && hover.avg != null ? (
              <ReferenceDot x={hover.km} y={hover.avg} r={3} fill={LINE} stroke="none" />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
