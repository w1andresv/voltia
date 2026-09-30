import { CloudOff, PlugZap } from "lucide-react";
import { formatElevation } from "@/lib/format";
import { BUC_BOG } from "./bucaramanga-bogota";

/**
 * Visuales pequeños para las tarjetas anchas de funciones del landing. El
 * perfil sale de los datos reales de Bucaramanga → Bogotá; las fichas y el
 * aviso reproducen los textos que muestra la app.
 */

const W = 360;
const H = 96;

/** Altura de la vía de Bucaramanga a Bogotá, del cañón del Chicamocha a la subida de Tunja. */
export function ElevationSpark() {
  const d = BUC_BOG;
  const max = d.maxM;
  const pts = d.elevM
    .filter((_, km) => km % 3 === 0)
    .map((m, i, all) => [(W * i) / (all.length - 1), H - 8 - ((H - 20) * m) / max] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const canyonX = (W * d.canyon.km) / d.distanceKm;
  return (
    <figure className="m-0 grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id="feature-elev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--landing-grad-b)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--landing-grad-b)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="feature-elev-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--landing-grad-a)" />
            <stop offset="1" stopColor="var(--landing-grad-b)" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#feature-elev)" />
        <path d={line} fill="none" stroke="url(#feature-elev-line)" strokeWidth={2} />
        <circle
          cx={canyonX}
          cy={H - 8 - ((H - 20) * d.canyon.elevM) / max}
          r={3.5}
          fill="var(--color-fg)"
        />
      </svg>
      <figcaption className="flex justify-between font-mono text-[10.5px] text-subtle">
        <span>Chicamocha {formatElevation(d.canyon.elevM)}</span>
        <span>máx. {formatElevation(d.maxM)}</span>
      </figcaption>
    </figure>
  );
}

function Chip({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={
        tone === "ok"
          ? "rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-semibold text-ok"
          : "rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"
      }
    >
      {children}
    </span>
  );
}

/** Dos fichas de estación como las del mapa: una compatible y otra que requiere adaptador. */
export function StationChips() {
  return (
    <div className="grid gap-2" aria-hidden>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
        <PlugZap className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs text-fg">CCS2 · 60 kW ×2</span>
        <Chip tone="ok">Disponible</Chip>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
        <PlugZap className="size-4 shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate text-xs text-fg">GB/T DC · 60 kW</span>
        <Chip tone="warn">Requiere adaptador</Chip>
      </div>
    </div>
  );
}

/** El aviso que aparece sin conexión en el planificador. */
export function OfflineNotice() {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-border bg-bg-elevated px-3 py-3"
      aria-hidden
    >
      <CloudOff className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold text-fg">Sin conexión</span>
        <span className="text-[11px] leading-snug text-muted">
          Tu último plan quedó guardado en este dispositivo.
        </span>
        <span className="justify-self-start rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg">
          Ver último plan
        </span>
      </div>
    </div>
  );
}
