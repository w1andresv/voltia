import {
  formatElevation,
  formatKm,
  formatKwh,
  formatKwhPer100,
  formatMinutes,
  formatPct,
} from "@/lib/format";
import { BUC_BOG } from "./bucaramanga-bogota";
import { TripFacts } from "./trip-facts";

/**
 * Gráfico del landing: Bucaramanga → Bogotá con el MG S5 EV. Altura de la vía
 * (área) y batería (línea) calculadas con el planificador real (ver
 * bucaramanga-bogota.ts). Se dibuja en el servidor.
 */
const W = 1000;
const X0 = 60;
const X1 = 940;
const Y_TOP = 70;
const Y_BOT = 262;
const E_MAX = 4000;

const x = (km: number) => X0 + ((X1 - X0) * km) / BUC_BOG.distanceKm;
const yElev = (m: number) => Y_BOT - ((Y_BOT - Y_TOP) * m) / E_MAX;
const ySoc = (pct: number) => Y_BOT - ((Y_BOT - Y_TOP) * pct) / 100;
const f = (n: number) => n.toFixed(1);

/** Batería por km, con el salto vertical de cada carga en el km de la parada. */
function socPath(): string {
  const pts: [number, number][] = [];
  let next = 0;
  BUC_BOG.soc.forEach((soc, km) => {
    const stop = BUC_BOG.stops[next];
    if (stop && km > stop.km) {
      pts.push([stop.km, stop.arrive], [stop.km, stop.depart]);
      next += 1;
    }
    pts.push([km, soc]);
  });
  pts.push([BUC_BOG.distanceKm, BUC_BOG.arrivalSoc]);
  return pts.map(([km, s], i) => `${i ? "L" : "M"}${f(x(km))},${f(ySoc(s))}`).join("");
}

function elevationPaths() {
  const line = BUC_BOG.elevM.map((m, km) => `${km ? "L" : "M"}${f(x(km))},${f(yElev(m))}`).join("");
  return { line, area: `${line} L${f(x(BUC_BOG.elevM.length - 1))},${Y_BOT} L${X0},${Y_BOT} Z` };
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="grid content-start gap-0.5">
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-subtle">
        {label}
      </span>
      <span className="text-lg font-bold tabular-nums tracking-tight">{value}</span>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

export function RouteProfile() {
  const elev = elevationPaths();
  const soc = socPath();
  const d = BUC_BOG;

  return (
    <figure className="m-0 grid gap-4 rounded-xl border border-border bg-surface p-4 shadow-panel md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 className="text-base font-bold tracking-tight">
          Bucaramanga → Bogotá · {formatKm(d.distanceKm)} · {d.vehicle}
        </h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-fg/15" /> Altura de la vía
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-accent" /> Batería
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-accent" /> Carga rápida 60 kW
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} 310`}
          role="img"
          className="block h-auto w-full min-w-[640px]"
          aria-label={`Bucaramanga a Bogotá con el ${d.vehicle}: sale al 100 %, baja al cañón del Chicamocha (${d.canyon.elevM} m), sube hasta ${formatElevation(d.maxM)} cerca de Tunja, carga en ${d.stops.map((s) => `${s.name} (${Math.round(s.arrive)} a ${s.depart} %)`).join(" y ")} y llega a Bogotá con ${Math.round(d.arrivalSoc)} %.`}
        >
          <defs>
            <linearGradient id="landing-terrain" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-fg)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--color-fg)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Rejilla y ejes: altura a la izquierda, batería a la derecha */}
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={X0} x2={X1} y1={ySoc(p)} y2={ySoc(p)} stroke="var(--color-border)" />
              <text x={X1 + 8} y={ySoc(p) + 4} className="fill-accent font-mono text-[11px]">
                {p} %
              </text>
              <text
                x={X0 - 8}
                y={ySoc(p) + 4}
                textAnchor="end"
                className="fill-subtle font-mono text-[11px]"
              >
                {((p / 100) * E_MAX).toLocaleString("es-CO")}
              </text>
            </g>
          ))}
          <text
            x={X0 - 8}
            y={Y_TOP - 12}
            textAnchor="end"
            className="fill-subtle font-mono text-[10.5px]"
          >
            m
          </text>

          {/* Altura */}
          <path d={elev.area} fill="url(#landing-terrain)" />
          <path
            d={elev.line}
            fill="none"
            stroke="var(--color-fg)"
            strokeOpacity={0.35}
            strokeWidth={1.2}
          />
          <text
            x={x(d.canyon.km)}
            y={yElev(d.canyon.elevM) + 16}
            textAnchor="middle"
            className="fill-subtle font-mono text-[10.5px]"
          >
            Chicamocha {d.canyon.elevM} m
          </text>

          {/* Margen de seguridad */}
          <line
            x1={X0}
            x2={X1}
            y1={ySoc(d.safetyPct)}
            y2={ySoc(d.safetyPct)}
            stroke="var(--color-danger)"
            strokeDasharray="5 4"
            strokeOpacity={0.7}
          />
          <text x={x(140)} y={ySoc(d.safetyPct) - 6} className="fill-danger text-[11px]">
            margen {d.safetyPct} %
          </text>

          {/* Batería */}
          <path
            d={soc}
            pathLength={1}
            className="landing-draw"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2.4}
            strokeLinejoin="round"
          />
          <text x={x(0) + 4} y={ySoc(100) - 8} className="fill-accent text-[11.5px] font-bold">
            {d.initialSoc} %
          </text>
          <text
            x={X1 - 4}
            y={ySoc(d.arrivalSoc) + 20}
            textAnchor="end"
            className="fill-accent text-[11.5px] font-bold"
          >
            llega con {Math.round(d.arrivalSoc)} %
          </text>

          {/* Paradas */}
          {d.stops.map((s) => (
            <g key={s.name}>
              <line
                x1={x(s.km)}
                x2={x(s.km)}
                y1={Y_TOP - 22}
                y2={ySoc(s.depart)}
                stroke="var(--color-accent)"
                strokeWidth={1.2}
                strokeDasharray="2 3"
              />
              <circle
                cx={x(s.km)}
                cy={ySoc(s.arrive)}
                r={5}
                fill="var(--color-surface)"
                stroke="var(--color-accent)"
                strokeWidth={2}
              />
              <circle cx={x(s.km)} cy={ySoc(s.depart)} r={5} fill="var(--color-accent)" />
              <text
                x={x(s.km)}
                y={Y_TOP - 44}
                textAnchor="middle"
                className="fill-fg text-[12px] font-bold"
              >
                {s.name}
              </text>
              <text
                x={x(s.km)}
                y={Y_TOP - 29}
                textAnchor="middle"
                className="fill-subtle font-mono text-[10.5px]"
              >
                {Math.round(s.arrive)} → {s.depart} % · {s.minutes} min
              </text>
            </g>
          ))}

          {/* Pueblos */}
          {d.towns.map(([name, km], i) => (
            <g key={name}>
              <line x1={x(km)} x2={x(km)} y1={Y_BOT} y2={Y_BOT + 5} stroke="var(--color-muted)" />
              <text
                x={x(km)}
                y={Y_BOT + 20}
                textAnchor={i === 0 ? "start" : i === d.towns.length - 1 ? "end" : "middle"}
                className="fill-fg text-[11.5px] font-semibold"
              >
                {name}
              </text>
              <text
                x={x(km)}
                y={Y_BOT + 35}
                textAnchor={i === 0 ? "start" : i === d.towns.length - 1 ? "end" : "middle"}
                className="fill-subtle font-mono text-[10.5px]"
              >
                km {Math.round(km)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Energía"
          value={formatKwh(d.energyKwh)}
          note={`${formatKwhPer100(d.kwhPer100km)} · regenera ${formatKwh(d.regenKwh)}`}
        />
        <Stat
          label="Paradas"
          value={`${d.stops.length}`}
          note={`${formatMinutes(d.chargeMinutes)} cargando`}
        />
        <Stat
          label="Llegada"
          value={formatPct(d.arrivalSoc)}
          note={`sale con ${formatPct(d.initialSoc)}`}
        />
        <Stat
          label="Tiempo total"
          value={formatMinutes(d.totalMinutes)}
          note={`${formatMinutes(d.driveMinutes)} manejando`}
        />
        <Stat
          label="Desnivel"
          value={`+${formatElevation(d.gainM)}`}
          note={`−${formatElevation(d.lossM)} · máx. ${formatElevation(d.maxM)}`}
        />
      </div>

      <TripFacts />

      <figcaption className="text-xs leading-relaxed text-muted">
        Calculado con el motor v2 de EV-on-way sobre la carretera real, con la altura del terreno
        cada 100 m, el vehículo y las condiciones de arriba. Estaciones de carga rápida en Santana y
        Tunja. Es un ejemplo; tu viaje puede variar según el día, el clima y las estaciones
        disponibles.
      </figcaption>
    </figure>
  );
}
