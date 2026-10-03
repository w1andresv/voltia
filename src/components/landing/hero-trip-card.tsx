import { BatteryCharging, Flag, MapPin } from "lucide-react";
import { formatKm, formatKwh, formatMinutes, formatPct } from "@/lib/format";
import { BUC_BOG } from "./bucaramanga-bogota";

/**
 * Tarjeta de la portada: el plan Bucaramanga → Bogotá en miniatura (altura de
 * la vía, batería y las dos cargas), con los mismos datos del gráfico grande.
 * Se dibuja en el servidor.
 */
const W = 520;
const H = 150;
const X0 = 6;
const X1 = W - 6;
const Y_TOP = 12;
const Y_BOT = H - 6;
const E_MAX = 4000;
const d = BUC_BOG;

const x = (km: number) => X0 + ((X1 - X0) * km) / d.distanceKm;
const yElev = (m: number) => Y_BOT - ((Y_BOT - Y_TOP) * 0.85 * m) / E_MAX;
const ySoc = (pct: number) => Y_BOT - ((Y_BOT - Y_TOP) * pct) / 100;
const f = (n: number) => n.toFixed(1);

function paths() {
  const elev = d.elevM.map((m, km) => `${km ? "L" : "M"}${f(x(km))},${f(yElev(m))}`).join("");
  const pts: [number, number][] = [];
  let next = 0;
  d.soc.forEach((soc, km) => {
    const stop = d.stops[next];
    if (stop && km > stop.km) {
      pts.push([stop.km, stop.arrive], [stop.km, stop.depart]);
      next += 1;
    }
    pts.push([km, soc]);
  });
  pts.push([d.distanceKm, d.arrivalSoc]);
  return {
    area: `${elev} L${f(x(d.elevM.length - 1))},${Y_BOT} L${X0},${Y_BOT} Z`,
    soc: pts.map(([km, s], i) => `${i ? "L" : "M"}${f(x(km))},${f(ySoc(s))}`).join(""),
  };
}

function Leg({
  icon,
  place,
  detail,
  value,
}: {
  icon: React.ReactNode;
  place: string;
  detail: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{place}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-fg">{value}</span>
    </li>
  );
}

export function HeroTripCard() {
  const p = paths();
  const [first, second] = d.stops;
  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="landing-gradient-bg absolute -inset-6 -z-10 rounded-[2rem] opacity-20 blur-3xl"
      />
      <figure className="landing-ring m-0 rounded-2xl bg-surface/85 p-4 shadow-float backdrop-blur-xl sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-subtle">
              Plan de viaje
            </div>
            <div className="mt-1 text-lg font-bold tracking-tight text-fg">
              Bucaramanga → Bogotá
            </div>
            <div className="text-xs text-muted">
              {formatKm(d.distanceKm)} · {formatMinutes(d.totalMinutes)} · {d.vehicle}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent">
            Llega con {formatPct(d.arrivalSoc)}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Batería de ${formatPct(d.initialSoc)} a ${formatPct(d.arrivalSoc)} sobre la altura de la vía, con cargas en ${first?.name} y ${second?.name}.`}
          className="mt-4 block h-auto w-full"
        >
          <defs>
            <linearGradient id="hero-terrain" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-fg)" stopOpacity="0.14" />
              <stop offset="1" stopColor="var(--color-fg)" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="hero-soc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--landing-grad-a)" />
              <stop offset="1" stopColor="var(--landing-grad-b)" />
            </linearGradient>
          </defs>
          <path d={p.area} fill="url(#hero-terrain)" />
          <line
            x1={X0}
            x2={X1}
            y1={ySoc(d.safetyPct)}
            y2={ySoc(d.safetyPct)}
            stroke="var(--color-danger)"
            strokeDasharray="4 4"
            strokeOpacity={0.55}
          />
          <path
            d={p.soc}
            pathLength={1}
            className="landing-draw"
            fill="none"
            stroke="url(#hero-soc)"
            strokeWidth={2.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {d.stops.map((s) => (
            <g key={s.name}>
              <circle cx={x(s.km)} cy={ySoc(s.depart)} r={4.5} fill="var(--color-accent)" />
              <circle
                cx={x(s.km)}
                cy={ySoc(s.depart)}
                r={9}
                fill="none"
                stroke="var(--color-accent)"
                strokeOpacity={0.35}
              />
            </g>
          ))}
        </svg>

        <ol className="m-0 mt-2 list-none divide-y divide-border p-0">
          <Leg
            icon={<MapPin className="size-4" />}
            place="Bucaramanga"
            detail="Salida"
            value={formatPct(d.initialSoc)}
          />
          {d.stops.map((s) => (
            <Leg
              key={s.name}
              icon={<BatteryCharging className="size-4" />}
              place={s.name}
              detail={`km ${Math.round(s.km)} · ${s.minutes} min a ${s.kw} kW`}
              value={`${Math.round(s.arrive)} → ${s.depart} %`}
            />
          ))}
          <Leg
            icon={<Flag className="size-4" />}
            place="Bogotá"
            detail={`Regenera ${formatKwh(d.regenKwh)} en las bajadas`}
            value={formatPct(d.arrivalSoc)}
          />
        </ol>
      </figure>
    </div>
  );
}
