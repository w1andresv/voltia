import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RoutePlan } from "@/lib/domain/types";
import { formatElevation, formatKm, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";

export function ElevationChart({ plan }: { plan: RoutePlan }) {
  const setHover = usePlanner((s) => s.setHoverKm);
  const hoverKm = usePlanner((s) => s.hoverKm);

  const data = useMemo(
    () =>
      plan.samples.map((s) => ({
        km: Number(s.km.toFixed(1)),
        elev: Math.round(s.elevM),
        soc: Math.round(s.soc),
      })),
    [plan.samples],
  );

  const chargers = plan.stops.map((st) => {
    const sample = plan.samples.reduce((best, s) =>
      Math.abs(s.km - st.kmAlongRoute) < Math.abs(best.km - st.kmAlongRoute) ? s : best,
    );
    return { km: Number(sample.km.toFixed(1)), elev: Math.round(sample.elevM), name: st.charger.name };
  });

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Perfil de elevación</h3>
        <span className="font-mono text-xs tabular-nums text-muted">
          +{formatElevation(plan.elevation.gainM)} / −{formatElevation(plan.elevation.lossM)}
        </span>
      </div>
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
              <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ddec8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3ddec8" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(238 242 246 / 0.08)" />
            <XAxis
              dataKey="km"
              tickFormatter={(v) => `${v}`}
              tick={{ fill: "#8b98a8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="elev"
              width={36}
              tickFormatter={(v) => `${v}`}
              tick={{ fill: "#8b98a8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as { km: number; elev: number; soc: number };
                return (
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs shadow-float">
                    <div>
                      {formatKm(d.km, 1)} · {formatElevation(d.elev)}
                    </div>
                    <div className="text-accent">{formatPct(d.soc)}</div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="elev" stroke="#3ddec8" strokeWidth={1.6} fill="url(#elevFill)" />
            {hoverKm != null ? (
              <ReferenceLine x={Number(hoverKm.toFixed(1))} stroke="rgb(238 242 246 / 0.35)" />
            ) : null}
            {chargers.map((c) => (
              <ReferenceDot
                key={c.name + c.km}
                x={c.km}
                y={c.elev}
                r={5}
                fill="#eef2f6"
                stroke="#3ddec8"
                strokeWidth={2}
              />
            ))}
            {hoverKm != null ? (
              <ReferenceDot
                x={Number(hoverKm.toFixed(1))}
                y={plan.samples.reduce((b, s) => (Math.abs(s.km - hoverKm) < Math.abs(b.km - hoverKm) ? s : b)).elevM}
                r={3}
                fill="#3ddec8"
                stroke="none"
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
