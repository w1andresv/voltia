/**
 * Perfil de elevación aproximado de Piedecuesta → Vélez para el landing: el
 * mismo que usan las demos de la documentación. Se dibuja en el servidor; solo
 * ilustra por qué la montaña pesa en el consumo, no sale del modelo real.
 */
const TOWNS: readonly (readonly [km: number, name: string, elevationM: number])[] = [
  [0, "Piedecuesta", 1000],
  [15, "Los Curos", 1500],
  [35, "Pescadero", 500],
  [52, "Aratoca", 1800],
  [76, "San Gil", 1100],
  [98, "Socorro", 1230],
  [128, "Oiba", 1420],
  [150, "Suaita", 1500],
  [168, "Santana", 1550],
  [193, "Barbosa", 1600],
  [213, "Vélez", 2100],
];

const STOPS = [
  { name: "San Gil", km: 76, detail: "AC 22 kW", dc: false },
  { name: "Socorro", km: 98, detail: "DC 60 kW", dc: true },
  { name: "Santana", km: 168, detail: "DC 60 kW", dc: true },
] as const;

const DIST = 213;
const X0 = 56;
const X1 = 976;
const Y_TOP = 58;
const Y_BOT = 222;
const E_MAX = 2400;
const LABEL_ABOVE = new Set(["Los Curos", "Aratoca", "Vélez"]);

const x = (km: number) => X0 + ((X1 - X0) * km) / DIST;
const y = (m: number) => Y_BOT - ((Y_BOT - Y_TOP) * m) / E_MAX;

function elevationAt(km: number): number {
  for (let i = 1; i < TOWNS.length; i++) {
    const [k1, , e1] = TOWNS[i]!;
    const [k0, , e0] = TOWNS[i - 1]!;
    if (km <= k1) return e0 + ((e1 - e0) * (km - k0)) / (k1 - k0);
  }
  return TOWNS[TOWNS.length - 1]![2];
}

/** Curva suave (Catmull-Rom a Bézier) que pasa por cada pueblo. */
function profilePath(): string {
  const pts = TOWNS.map(([km, , m]) => [x(km), y(m)] as const);
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0]!)},${f(c1[1]!)} ${f(c2[0]!)},${f(c2[1]!)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

export function RouteProfile() {
  const line = profilePath();
  const area = `${line} L${X1},${Y_BOT} L${X0},${Y_BOT} Z`;
  const stopKms = new Set<number>(STOPS.map((s) => s.km));

  return (
    <figure className="m-0 grid gap-3 rounded-xl border border-border bg-surface p-4 shadow-panel md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 className="text-base font-bold tracking-tight">Piedecuesta → Vélez · 213 km</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-accent" /> Carga rápida DC 60 kW
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-muted" /> Carga AC 22 kW
            (ejemplo)
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 1000 280"
          role="img"
          className="block h-auto w-full min-w-[620px]"
          aria-label="Perfil de elevación aproximado de Piedecuesta a Vélez: baja a 500 m en el cañón del Chicamocha, sube a 1.800 m en Aratoca y termina a 2.100 m en Vélez. Estaciones en San Gil (km 76), Socorro (km 98) y Santana (km 168)."
        >
          <defs>
            <linearGradient id="landing-terrain" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[0, 500, 1000, 1500, 2000].map((m) => (
            <g key={m}>
              <line x1={X0} x2={X1} y1={y(m)} y2={y(m)} stroke="var(--color-border)" />
              <text
                x={X0 - 8}
                y={y(m) + 4}
                textAnchor="end"
                className="fill-subtle font-mono text-[11px]"
              >
                {m === 0 ? "0 m" : m.toLocaleString("es-CO")}
              </text>
            </g>
          ))}
          {[0, 50, 100, 150, 200].map((km) => (
            <text
              key={km}
              x={x(km)}
              y={Y_BOT + 18}
              textAnchor="middle"
              className="fill-subtle font-mono text-[11px]"
            >
              km {km}
            </text>
          ))}
          <path d={area} fill="url(#landing-terrain)" />
          <path
            d={line}
            pathLength={1}
            className="landing-draw"
            fill="none"
            stroke="var(--color-fg)"
            strokeOpacity={0.75}
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {TOWNS.filter(([km]) => !stopKms.has(km)).map(([km, name, m]) => (
            <g key={name}>
              <circle cx={x(km)} cy={y(m)} r={2.5} fill="var(--color-muted)" />
              <text
                x={x(km)}
                y={LABEL_ABOVE.has(name) ? y(m) - 10 : y(m) + 18}
                textAnchor={km === 0 ? "start" : km === DIST ? "end" : "middle"}
                className="fill-fg text-[11.5px] font-semibold"
              >
                {name}
              </text>
            </g>
          ))}
          <text
            x={x(35)}
            y={y(500) + 32}
            textAnchor="middle"
            className="fill-subtle font-mono text-[10.5px]"
          >
            cañón del Chicamocha
          </text>

          {STOPS.map((s) => {
            const cx = x(s.km);
            const cy = y(elevationAt(s.km));
            const top = Y_TOP - 34;
            const left = s.name === "San Gil";
            const tx = left ? cx - 6 : cx;
            const anchor = left ? "end" : "middle";
            return (
              <g key={s.name}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={top + 22}
                  y2={cy - 6}
                  stroke={s.dc ? "var(--color-accent)" : "var(--color-muted)"}
                  strokeWidth={1.5}
                  strokeDasharray={s.dc ? undefined : "3 3"}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill={s.dc ? "var(--color-accent)" : "var(--color-surface)"}
                  stroke={s.dc ? "none" : "var(--color-muted)"}
                  strokeWidth={2}
                />
                <text
                  x={tx}
                  y={top + 2}
                  textAnchor={anchor}
                  className="fill-fg text-[12px] font-bold"
                >
                  {s.name}
                </text>
                <text
                  x={tx}
                  y={top + 16}
                  textAnchor={anchor}
                  className="fill-subtle font-mono text-[10.5px]"
                >
                  km {s.km} · {s.detail}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="text-xs text-muted">
        Perfil aproximado. En el planificador la elevación sale de Mapbox Terrain-RGB (zoom 11 @2x,
        unos 38 m por píxel), muestreada cada 100 m de la ruta.
      </figcaption>
    </figure>
  );
}
