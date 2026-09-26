import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { consumptionSeries } from "@/domain/ev/engines/chart/series";
import { REGEN_LEVEL_LABEL, type RoutePlan } from "@/domain/types";
import { formatKm, formatKwhPer100 } from "@/lib/format";
import { usePlanner } from "@/lib/store";

const LINE = "#d6b07e";

const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Solo formatea para el eje: las cifras salen de `consumptionSeries` (dominio). */
function chartData(plan: RoutePlan) {
  const series = consumptionSeries(plan.samples);
  return {
    windowKm: series.windowKm,
    rows: series.points.map((p) => ({
      km: Number(p.km.toFixed(1)),
      win: r1(p.windowKwhPer100),
      avg: r1(p.cumulativeKwhPer100),
    })),
  };
}

export function ConsumptionChart({ plan }: { plan: RoutePlan }) {
  const setHover = usePlanner((s) => s.setHoverKm);
  const hoverKm = usePlanner((s) => s.hoverKm);
  const regenLevel = usePlanner((s) => s.conditions.regenLevel);

  const { rows: data, windowKm } = useMemo(() => chartData(plan), [plan]);
  const rates = data.flatMap((d) => [d.win, d.avg]).filter((n): n is number => n != null);
  const peak = rates.length ? Math.max(...rates) : plan.avgKwhPer100km;
  const floor = rates.length ? Math.min(0, ...rates) : 0;
  const mean = plan.avgKwhPer100km;
  const hover =
    hoverKm == null
      ? null
      : data.reduce((b, s) => (Math.abs(s.km - hoverKm) < Math.abs(b.km - hoverKm) ? s : b));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Consumo por tramo</h3>
        <span className="font-mono text-xs tabular-nums text-muted">{formatKwhPer100(mean)}</span>
      </div>
      <p className="mb-1.5 text-xs text-muted">
        Energía neta cada {windowKm} km (negativa si la bajada regenera más de lo que gasta); la línea punteada es
        el promedio acumulado. Regeneración {REGEN_LEVEL_LABEL[regenLevel].toLowerCase()}.
      </p>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
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
              domain={[Math.floor(floor < 0 ? floor * 1.12 : 0), Math.max(12, Math.ceil(peak * 1.12))]}
              tick={{ fill: "#8b98a8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as { km: number; win: number | null; avg: number | null };
                if (d.win == null) return null;
                return (
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs shadow-float">
                    <div>
                      {formatKm(d.km, 1)} · {formatKwhPer100(d.win)}
                    </div>
                    {d.avg != null ? (
                      <div className="text-muted">Promedio acumulado {formatKwhPer100(d.avg)}</div>
                    ) : null}
                  </div>
                );
              }}
            />
            <ReferenceLine y={mean} stroke="rgb(238 242 246 / 0.28)" strokeDasharray="4 4" />
            {hoverKm != null ? (
              <ReferenceLine x={Number(hoverKm.toFixed(1))} stroke="rgb(238 242 246 / 0.35)" />
            ) : null}
            <Area
              type="stepAfter"
              dataKey="win"
              stroke={LINE}
              strokeWidth={1.4}
              fill="url(#avgFill)"
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="avg"
              stroke="rgb(238 242 246 / 0.55)"
              strokeWidth={1.2}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <ReferenceLine y={0} stroke="rgb(238 242 246 / 0.2)" />
            {hover && hover.win != null ? (
              <ReferenceDot x={hover.km} y={hover.win} r={3} fill={LINE} stroke="none" />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
