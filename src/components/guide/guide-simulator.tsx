"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import {
  batteryCurve,
  chargeMinutes,
  depletionKm,
  elevationAt,
  energyPerKm,
  floorOf,
  GUIDE_DIST_KM,
  GUIDE_PRESETS,
  GUIDE_TOWNS,
  guideStations,
  pctOf,
  solveGuide,
  VEHICLE_MIN_SOC,
  walk,
  type GuideEngine,
  type GuideParams,
  type GuidePresetId,
  type GuideResult,
} from "@/lib/guide-sim";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./primitives";

const PRESET_LABEL: Record<GuidePresetId, string> = {
  local: "Caso localhost (90 %, 1 pasajero)",
  vercel: "Caso Vercel (80 %, 2 pasajeros)",
  low: "Poca batería (45 %)",
};

const f0 = (n: number) => n.toFixed(0);
const short = (name: string) => name.split(" · ")[0]!;

function Range({
  label,
  value,
  shown,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  shown: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 font-medium">
        {label}
        <output htmlFor={id} className="font-mono text-xs tabular-nums text-accent">
          {shown}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find(([v]) => String(v) === e.target.value);
          if (hit) onChange(hit[0]);
        }}
        className="h-10 rounded-md border border-border bg-bg-elevated px-2 text-sm text-fg"
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Card({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: string;
}) {
  return (
    <div className="grid content-start gap-1 rounded-lg bg-surface-2 px-3.5 py-3">
      <Eyebrow>{label}</Eyebrow>
      <span className={cn("text-2xl font-extrabold tabular-nums tracking-tight", tone)}>
        {value}
      </span>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

/** Curva de batería sobre la ruta, con piso, altura de fondo, estaciones y paradas. */
function Chart({
  params,
  result,
  stroke,
}: {
  params: GuideParams;
  result: GuideResult;
  stroke: string;
}) {
  const W = 860;
  const H = 300;
  const L = 44;
  const R = 16;
  const T = 18;
  const B = 58;
  const x = (km: number) => L + ((W - L - R) * km) / GUIDE_DIST_KM;
  const y = (s: number) => T + (H - T - B) * (1 - Math.max(-10, Math.min(100, s)) / 100);
  const floor = floorOf(params);
  const e = energyPerKm(params);
  const start = params.soc + (result.viable ? result.preCharge : 0);
  const pts = batteryCurve(e, start, result.viable ? result.stops : []);
  const d = pts
    .map(([km, s], i) => `${i ? "L" : "M"}${x(km).toFixed(1)},${y(s).toFixed(1)}`)
    .join("");
  let terrain = "";
  for (let k = 0; k <= GUIDE_DIST_KM; k += 3) {
    terrain += `${k ? "L" : "M"}${x(k).toFixed(1)},${(y(0) - ((elevationAt(k) - 400) / 1800) * 60).toFixed(1)}`;
  }
  const empty = result.viable ? null : depletionKm(e, start);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Batería a lo largo de la ruta Piedecuesta a Vélez"
        className="block h-auto w-full min-w-[560px]"
      >
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-border)" />
            <text
              x={L - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-subtle font-mono text-[11px]"
            >
              {v}%
            </text>
          </g>
        ))}
        <rect
          x={L}
          y={y(floor)}
          width={W - L - R}
          height={y(0) - y(floor)}
          fill="var(--color-danger)"
          opacity={0.08}
        />
        <line
          x1={L}
          x2={W - R}
          y1={y(floor)}
          y2={y(floor)}
          stroke="var(--color-danger)"
          strokeDasharray="5 4"
        />
        <text x={W - R} y={y(floor) - 5} textAnchor="end" className="fill-danger text-[11px]">
          piso {floor}%
        </text>
        <path d={terrain} fill="none" stroke="var(--color-muted)" opacity={0.45} />
        <path
          d={`${d} L${x(GUIDE_DIST_KM)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={stroke}
          opacity={0.14}
        />
        <path d={d} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" />
        {GUIDE_TOWNS.map(([km, name]) => (
          <g key={name}>
            <line x1={x(km)} x2={x(km)} y1={y(0)} y2={y(0) + 5} stroke="var(--color-muted)" />
            <text x={x(km)} y={y(0) + 18} textAnchor="middle" className="fill-muted text-[10.5px]">
              {name}
            </text>
            <text
              x={x(km)}
              y={y(0) + 31}
              textAnchor="middle"
              className="fill-subtle font-mono text-[10px]"
            >
              {km}
            </text>
          </g>
        ))}
        {guideStations(params.sanGil).map((st) => (
          <circle
            key={st.name}
            cx={x(st.km)}
            cy={y(96)}
            r={5}
            fill={st.dc ? "var(--color-accent)" : "var(--color-warn)"}
          />
        ))}
        {result.viable
          ? result.stops.map((s) => (
              <circle
                key={s.station.name}
                cx={x(s.station.km)}
                cy={y(s.arrive)}
                r={4.5}
                fill="var(--color-surface)"
                stroke={stroke}
                strokeWidth={2}
              />
            ))
          : null}
        {empty != null ? (
          <g>
            <line
              x1={x(empty)}
              x2={x(empty)}
              y1={T}
              y2={y(0)}
              stroke="var(--color-danger)"
              strokeDasharray="4 3"
            />
            <text x={x(empty) + 4} y={T + 12} className="fill-danger text-[11px]">
              sin batería
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** Por qué el motor eligió ese plan, en frases cortas. */
function reasons(
  engine: GuideEngine,
  p: GuideParams,
  r: GuideResult & { viable: true },
): ReactNode[] {
  const floor = floorOf(p);
  const e = energyPerKm(p);
  const socorro = walk(e, p.soc, 0, 98).end - pctOf(2 * (p.consumption / 100));
  const names = r.stops.map((s) => s.station.name).join(" → ");
  const lines: ReactNode[] = [
    <>
      Piso de batería = máx(mínimo del vehículo {VEHICLE_MIN_SOC} %, margen {p.margin} %) ={" "}
      <b>{floor} %</b>: no se acepta llegar a ninguna estación ni pasar por ningún punto por debajo.
    </>,
    <>
      Saliendo con {p.soc} % llegarías a Socorro con ≈ <b>{f0(socorro)} %</b> (tras el desvío) →{" "}
      {socorro >= floor ? (
        "Socorro es alcanzable."
      ) : (
        <>
          Socorro queda <b>fuera de alcance</b> por el piso.
        </>
      )}
    </>,
  ];
  if (engine === "v2") {
    if (r.preCharge) {
      lines.push(
        <>
          Con {p.soc} % no hay plan que respete el piso: la búsqueda binaria encuentra que hacen
          falta <b>+{r.preCharge} %</b> antes de salir, y con eso la mejor opción es{" "}
          {names || "llegar sin parar"}.
        </>,
      );
    }
    if (r.stops.some((s) => s.station.dc) && p.fastBuffer) {
      lines.push(
        <>
          En carga rápida se carga el mínimo para llegar a la siguiente parada + {p.fastBuffer}{" "}
          puntos (sin pasar de {Math.min(90, p.cap)} %). En la última parada se carga solo lo
          necesario para llegar a Vélez con la reserva: llegas con {f0(r.arrival)} %.
        </>,
      );
    }
    return lines;
  }
  if (r.preCharge) {
    lines.push(
      <>
        Con {p.soc} % no se llega a ninguna estación sobre el piso: v1 pide cargar{" "}
        <b>+{r.preCharge} %</b> antes de salir y sigue con {names || "el viaje sin parar"}.
      </>,
    );
  }
  if (r.stops.length) {
    lines.push(
      p.strategy === "fewer"
        ? 'En "menos paradas", v1 elige la estación alcanzable más lejana.'
        : "Entre las alcanzables, v1 elige la de menor puntaje (desvío, potencia, qué tan lleno llegas) y no revisa combinaciones: por eso puede parar más de lo necesario.",
    );
  }
  if (r.stops.some((s) => s.station.dc)) {
    lines.push(
      `Cuánto cargar: lo necesario para la siguiente + ${p.strategy === "fastest" ? 2 : 4} puntos${
        p.strategy === "fastest" ? ", y al menos la llegada + 12" : ""
      }; en DC al menos la llegada + 8; hasta el tope de ${p.cap} %.`,
    );
  }
  return lines;
}

export function GuideSimulator({ engine }: { engine: GuideEngine }) {
  const [params, setParams] = useState<GuideParams>(GUIDE_PRESETS.local);
  const set =
    <K extends keyof GuideParams>(k: K) =>
    (v: GuideParams[K]) =>
      setParams((p) => ({ ...p, [k]: v }));
  const result = useMemo(() => solveGuide(engine, params), [engine, params]);
  const total = useMemo(() => energyPerKm(params).reduce((a, b) => a + b, 0), [params]);
  const floor = floorOf(params);
  const stroke = engine === "v1" ? "var(--color-warn)" : "var(--color-accent)";

  return (
    <div className="grid gap-5 rounded-xl border border-border bg-surface p-4 shadow-panel md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Preajustes:</span>
        {(Object.keys(GUIDE_PRESETS) as GuidePresetId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setParams(GUIDE_PRESETS[id])}
            className="min-h-9 rounded-md border border-border bg-surface-2 px-3 text-xs font-semibold hover:border-border-strong"
          >
            {PRESET_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Range
          label="Batería al salir"
          value={params.soc}
          shown={`${params.soc} %`}
          min={20}
          max={100}
          onChange={set("soc")}
        />
        <Range
          label="Pasajeros"
          value={params.passengers}
          shown={String(params.passengers)}
          min={0}
          max={4}
          onChange={set("passengers")}
        />
        <Range
          label="Consumo en plano"
          value={params.consumption}
          shown={`${params.consumption} kWh/100 km`}
          min={12}
          max={26}
          onChange={set("consumption")}
        />
        <Select
          label="Margen de seguridad"
          value={params.margin}
          options={[
            [10, "Bajo (10 %)"],
            [15, "Normal (15 %)"],
            [20, "Conservador (20 %)"],
          ]}
          onChange={set("margin")}
        />
        <Range
          label="Llegada al destino"
          value={params.arrival}
          shown={`${params.arrival} %`}
          min={5}
          max={40}
          onChange={set("arrival")}
        />
        <Range
          label="Tope de carga en ruta"
          value={params.cap}
          shown={`${params.cap} %`}
          min={70}
          max={100}
          step={5}
          onChange={set("cap")}
        />
        <Select
          label="Estrategia"
          value={params.strategy}
          options={[
            ["fastest", "Más rápida"],
            ["fewer", "Menos paradas"],
            ["safer", "Más segura"],
          ]}
          onChange={set("strategy")}
        />
        <Select
          label="Estación de ejemplo en San Gil"
          value={params.sanGil ? 1 : 0}
          options={[
            [0, "No incluir"],
            [1, "Incluir (AC 22 kW)"],
          ]}
          onChange={(v) => set("sanGil")(v === 1)}
        />
        {engine === "v2" ? (
          <Select
            label="Extra en carga rápida"
            value={params.fastBuffer}
            options={[
              [10, "+10 % antes de otra parada (regla actual)"],
              [0, "Sin extra"],
            ]}
            onChange={set("fastBuffer")}
          />
        ) : null}
      </div>

      <Chart params={params} result={result} stroke={stroke} />

      {result.viable ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              label="Paradas"
              value={result.stops.length}
              note={result.stops.map((s) => short(s.station.name)).join(" → ") || "sin paradas"}
            />
            <Card
              label="Cargar antes de salir"
              value={result.preCharge ? `+${result.preCharge} %` : "no"}
              tone={result.preCharge ? "text-warn" : undefined}
              note={
                result.preCharge
                  ? `salir con ${params.soc + result.preCharge} %`
                  : `alcanza con ${params.soc} %`
              }
            />
            <Card
              label="Llegada a Vélez"
              value={`${f0(result.arrival)} %`}
              note={`reserva pedida ${Math.max(params.arrival, floor)} %`}
            />
            <Card
              label="Minutos cargando"
              value={f0(result.minutes)}
              note={`energía ${total.toFixed(1)} kWh`}
            />
          </div>
          {result.stops.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
              {result.stops.map((s) => (
                <li
                  key={s.station.name}
                  className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-b border-dashed border-border pb-1.5"
                >
                  <span
                    className={cn(
                      "rounded px-1.5 py-1 text-[11px] font-semibold uppercase leading-none tracking-wide",
                      s.station.dc ? "bg-accent/15 text-accent" : "border border-border text-warn",
                    )}
                  >
                    {s.station.dc ? "DC" : "AC"} {s.station.kw} kW
                  </span>
                  <b>{s.station.name}</b>
                  <span className="font-mono text-xs">km {s.station.km}</span>
                  <span>
                    llega {f0(s.arrive)} % → sale {s.depart} %
                  </span>
                  <span className="text-muted">
                    {f0(chargeMinutes(s.station, s.arrive, s.depart))} min
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div
            className={cn(
              "grid gap-1.5 border-l-[3px] py-1 pl-3 text-sm",
              engine === "v1" ? "border-warn" : "border-accent",
            )}
          >
            {reasons(engine, params, result).map((line, i) => (
              <p key={i} className="max-w-[75ch]">
                {line}
              </p>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              label="Resultado"
              value="No viable"
              tone="text-danger"
              note="ni saliendo al 100 %"
            />
            <Card
              label="Energía del viaje"
              value={`${total.toFixed(1)} kWh`}
              note={`${f0(pctOf(total))} % de la batería`}
            />
          </div>
          <p className="border-l-[3px] border-danger py-1 pl-3 text-sm">
            Con estas condiciones ninguna combinación de paradas respeta el piso de {floor} %. La
            app mostraría dónde se agota la batería y el motivo.
          </p>
        </>
      )}
    </div>
  );
}
