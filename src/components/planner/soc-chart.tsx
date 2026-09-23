import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RoutePlan } from "@/lib/domain/types";
import { formatKm, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";

export function SocChart({ plan }: { plan: RoutePlan }) {
  const setHover = usePlanner((s) => s.setHoverKm);
  const hoverKm = usePlanner((s) => s.hoverKm);
  const data = useMemo(
    () =>
      plan.samples.map((s) => ({
        km: Number(s.km.toFixed(1)),
        soc: Math.max(0, Math.round(s.soc * 10) / 10),
      })),
    [plan.samples],
  );

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Batería a lo largo de la ruta</h3>
        <span className="font-mono text-xs tabular-nums text-muted">mín {formatPct(plan.minSoc)}</span>
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
              <linearGradient id="socFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ddec8" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3ddec8" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(238 242 246 / 0.08)" />
            <XAxis dataKey="km" tick={{ fill: "#8b98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[0, 100]}
              width={32}
              tick={{ fill: "#8b98a8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as { km: number; soc: number };
                return (
                  <div className="rounded-md bg-surface-2 px-2.5 py-1.5 text-xs shadow-float">
                    {formatKm(d.km, 1)} · {formatPct(d.soc)}
                  </div>
                );
              }}
            />
            <ReferenceLine y={plan.safetyPct} stroke="#d6b07e" strokeDasharray="4 4" />
            <ReferenceLine y={plan.initialSoc} stroke="#8b98a8" strokeDasharray="2 4" strokeOpacity={0.5} />
            {hoverKm != null ? (
              <ReferenceLine x={Number(hoverKm.toFixed(1))} stroke="rgb(238 242 246 / 0.35)" />
            ) : null}
            <Area type="monotone" dataKey="soc" stroke="#3ddec8" strokeWidth={1.8} fill="url(#socFill)" />
            {plan.stops.map((st) => {
              const sample = plan.samples.reduce((b, s) =>
                Math.abs(s.km - st.kmAlongRoute) < Math.abs(b.km - st.kmAlongRoute) ? s : b,
              );
              return (
                <ReferenceDot
                  key={st.charger.id}
                  x={Number(sample.km.toFixed(1))}
                  y={Math.max(0, Math.min(100, sample.soc))}
                  r={4}
                  fill="#3ddec8"
                  stroke="#06221d"
                />
              );
            })}
            {hoverKm != null ? (
              <ReferenceDot
                x={Number(hoverKm.toFixed(1))}
                y={data.reduce((b, s) => (Math.abs(s.km - hoverKm) < Math.abs(b.km - hoverKm) ? s : b)).soc}
                r={3}
                fill="#3ddec8"
                stroke="none"
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {plan.stops.length ? (
        <p className="mt-1.5 text-xs text-muted">Los puntos marcan electrolineras recomendadas sobre la ruta.</p>
      ) : null}
    </div>
  );
}
