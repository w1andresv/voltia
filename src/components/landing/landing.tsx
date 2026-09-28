import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark, BrandName } from "@/components/brand/brand";
import { GuideLink } from "@/components/guide/guide-link";
import { RouteProfile } from "./route-profile";

/**
 * Landing en "/": qué hace EV-on-way y en qué se diferencian los dos motores.
 * Cada motor tiene su ruta: /v1 (por puntaje) y /v2 (programación dinámica).
 * v1 usa el ámbar (warn) y v2 el acento de la app, igual que en las guías.
 */

type Engine = "v1" | "v2";

const ENGINES: {
  id: Engine;
  tag: string;
  title: string;
  when: string;
  facts: [string, string][];
}[] = [
  {
    id: "v1",
    tag: "Actual · por defecto",
    title: "Planificador por puntaje",
    when: "El motor con el que nació EV-on-way y el que se usa por defecto.",
    facts: [
      [
        "Estaciones",
        "Mapa de electrolineras propio, con aportes de la comunidad. Se actualiza cada 6 h.",
      ],
      ["Energía", "Física base × ciclo 1,14 × estilo de manejo × clima."],
      ["Paradas", "Avanza estación por estación y elige la de mejor puntaje. Máximo 7."],
      ["Verificación", "No vuelve a trazar la ruta con las paradas."],
    ],
  },
  {
    id: "v2",
    tag: "Nuevo",
    title: "Planificador por programación dinámica",
    when: "El motor nuevo: física por tramo, electrolineras con estado en vivo y un plan óptimo de paradas.",
    facts: [
      [
        "Estaciones",
        "Red de electrolineras con estado en vivo; antes de confirmar el plan revisa las paradas elegidas.",
      ],
      [
        "Energía",
        "Aire, rodadura, pendiente y aceleración en tramos de 100 m, con regeneración limitada.",
      ],
      [
        "Paradas",
        "Compara todas las combinaciones de paradas y cuánto cargar en cada una. En carga rápida carga 10 puntos extra, hasta 90 % o el tope del vehículo.",
      ],
      ["Verificación", "Segunda pasada con la ruta real que pasa por las paradas."],
    ],
  },
];

type Step = { name: string; both?: string; v1?: string; v2?: string };

const STEPS: Step[] = [
  {
    name: "Origen y destino",
    both: "Escribes el lugar o lo tocas en el mapa.",
  },
  {
    name: "Electrolineras",
    v1: "Mapa de electrolineras propio, actualizado cada 6 h.",
    v2: "Red de electrolineras con estado en vivo, actualizada cada 15 min.",
  },
  { name: "Ruta", both: "Rutas alternativas por carretera, incluida una sin peajes." },
  {
    name: "Elevación",
    both: "Altura del terreno cada 100 m: cada subida y bajada cuenta.",
  },
  { name: "Clima", both: "Temperatura y viento en el camino." },
  {
    name: "Energía",
    v1: "Consumo base ajustado por estilo de manejo y clima.",
    v2: "Física tramo a tramo: aire, rodadura, pendiente y aceleración.",
  },
  {
    name: "Paradas",
    v1: "Elige la mejor estación, una a la vez.",
    v2: "Compara todas las combinaciones de paradas y cargas.",
  },
  {
    name: "Resultado",
    v1: "Plan directo; si no alcanza, pide salir con más carga.",
    v2: "Revisa las paradas y recalcula con la ruta real. Si no alcanza, muestra el km donde se agota la batería.",
  },
];

const COMPARISON: [string, string, string][] = [
  ["Electrolineras", "Mapa propio, actualizado cada 6 h", "Red con estado en vivo, cada 15 min"],
  [
    "Energía",
    "Física × ciclo 1,14 × estilo × clima",
    "Aire, rodadura, pendiente y aceleración por tramo",
  ],
  [
    "Paradas",
    "La mejor estación, una a la vez, máximo 7",
    "Todas las combinaciones de parada y carga",
  ],
  [
    "Cuánto cargar",
    "Lo necesario + 2 o 4 puntos; en carga rápida al menos 8 más de lo que llegas",
    "Lo óptimo; en carga rápida 10 puntos extra, hasta 90 % o el tope del vehículo",
  ],
  [
    "Si no alcanza",
    "Carga previa para llegar a la primera estación",
    "Con cuánto salir y en qué km se agota la batería",
  ],
  ["Verificación", "—", "Revisa las paradas elegidas y recalcula con la ruta real"],
];

const tone: Record<Engine, { text: string; soft: string; button: string; border: string }> = {
  v1: {
    text: "text-warn",
    soft: "bg-warn/12",
    button: "bg-warn text-bg hover:brightness-110",
    border: "border-warn/40",
  },
  v2: {
    text: "text-accent",
    soft: "bg-accent/12",
    button: "bg-accent text-accent-fg hover:brightness-110",
    border: "border-accent/40",
  },
};

function EngineButton({
  engine,
  children,
  className,
}: {
  engine: Engine;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/${engine}`}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
        tone[engine].button,
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4" />
    </Link>
  );
}

function SectionHead({
  label,
  title,
  children,
  id,
}: {
  label: string;
  title: string;
  children?: React.ReactNode;
  id: string;
}) {
  return (
    <div className="grid gap-2">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">
        {label}
      </span>
      <h2 id={id} className="text-2xl font-bold leading-tight tracking-tight md:text-4xl">
        {title}
      </h2>
      {children ? <p className="max-w-[64ch] text-muted">{children}</p> : null}
    </div>
  );
}

export function Landing() {
  return (
    <main className="relative z-20 h-dvh overflow-y-auto pt-14">
      <div className="mx-auto grid max-w-6xl gap-20 px-4 pb-20 pt-10 md:gap-28 md:px-8 md:pt-16">
        <header className="grid gap-8">
          <div className="grid items-end gap-8 md:grid-cols-[1.35fr_1fr] md:gap-14">
            <div className="grid gap-4">
              <div className="mb-4 flex items-center gap-3">
                <BrandMark className="size-14 md:size-16" />
                <div className="grid gap-1">
                  <BrandName className="text-3xl md:text-4xl" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle">
                    Rutas para vehículos eléctricos · Colombia
                  </span>
                </div>
              </div>
              <h1 className="text-[clamp(2.4rem,6.2vw,4.6rem)] font-extrabold leading-[0.98] tracking-[-0.03em]">
                De la cordillera al <span className="text-accent">plan de carga</span>
              </h1>
            </div>
            <div className="grid gap-5">
              <p className="text-lg text-muted">
                EV-on-way calcula cuánta batería gasta tu carro en cada subida y bajada, y decide
                dónde parar y cuánto cargar.{" "}
                <span className="font-semibold text-fg">Hay dos motores de cálculo</span>: elige uno
                para planificar, o compáralos con la misma ruta.
              </p>
              <div className="flex flex-wrap gap-3">
                <EngineButton engine="v1">
                  <span className="font-mono text-xs opacity-80">V1</span> Planificar por puntaje
                </EngineButton>
                <EngineButton engine="v2">
                  <span className="font-mono text-xs opacity-80">V2</span> Planificar con
                  programación dinámica
                </EngineButton>
              </div>
            </div>
          </div>
          <RouteProfile />
        </header>

        <section aria-labelledby="motores" className="grid scroll-mt-20 gap-8">
          <SectionHead
            id="motores"
            label="Los dos motores"
            title="Misma ruta, dos formas de decidir"
          >
            Los dos reciben el mismo vehículo, las mismas condiciones del viaje y la misma ruta. La
            dirección elige el motor: <code className="font-mono text-sm">/v1</code> o{" "}
            <code className="font-mono text-sm">/v2</code>.
          </SectionHead>
          <div className="grid gap-5 md:grid-cols-2">
            {ENGINES.map((e) => (
              <article
                key={e.id}
                className="relative grid content-start gap-5 overflow-hidden rounded-xl border border-border bg-surface p-6 shadow-panel"
              >
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -right-2 -top-8 select-none text-[9rem] font-extrabold leading-none tracking-[-0.06em] opacity-15",
                    tone[e.id].text,
                  )}
                >
                  {e.id.toUpperCase()}
                </span>
                <span
                  className={cn(
                    "relative justify-self-start rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
                    tone[e.id].text,
                    tone[e.id].border,
                  )}
                >
                  {e.tag}
                </span>
                <div className="relative grid gap-2">
                  <h3 className="max-w-[16ch] text-2xl font-bold leading-tight tracking-tight">
                    {e.title}
                  </h3>
                  <p className="text-sm text-muted">{e.when}</p>
                </div>
                <dl className="relative m-0 border-t border-border">
                  {e.facts.map(([k, v]) => (
                    <div
                      key={k}
                      className="grid gap-1 border-b border-border py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3"
                    >
                      <dt className="pt-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">
                        {k}
                      </dt>
                      <dd className="m-0 text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3">
                  <EngineButton engine={e.id}>Abrir planificador {e.id}</EngineButton>
                  <GuideLink
                    href={`/${e.id}/como-funciona`}
                    className={cn("text-sm font-semibold hover:underline", tone[e.id].text)}
                  >
                    Cómo funciona {e.id} →
                  </GuideLink>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="recorrido" className="grid gap-8">
          <SectionHead
            id="recorrido"
            label="El recorrido"
            title="Qué pasa entre elegir el destino y ver el plan"
          >
            Los pasos en una sola franja son iguales en los dos motores. Donde la franja se divide,
            cada uno hace algo distinto.
          </SectionHead>
          <ol className="m-0 list-none overflow-hidden rounded-xl border border-border bg-surface p-0 shadow-panel">
            <li
              aria-hidden
              className="hidden grid-cols-[3rem_1fr_1fr] border-b border-border bg-surface-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] md:grid"
            >
              <span />
              <span className="px-4 py-3 text-warn">v1</span>
              <span className="px-4 py-3 text-accent">v2</span>
            </li>
            {STEPS.map((s, i) => (
              <li
                key={s.name}
                className="grid grid-cols-[2.5rem_1fr] border-b border-border last:border-b-0 md:grid-cols-[3rem_1fr_1fr]"
              >
                <span className="border-r border-border py-4 text-center font-mono text-sm tabular-nums text-subtle">
                  {i + 1}
                </span>
                {s.both ? (
                  <div className="grid content-start gap-1 px-4 py-3.5 md:col-span-2">
                    <b className="font-bold">{s.name}</b>
                    <span className="text-sm text-muted">{s.both}</span>
                  </div>
                ) : (
                  <>
                    <div className="grid content-start gap-1 border-b border-border bg-warn/10 px-4 py-3.5 md:border-b-0 md:border-r">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-warn md:hidden">
                        v1
                      </span>
                      <b className="font-bold">{s.name}</b>
                      <span className="text-sm text-muted">{s.v1}</span>
                    </div>
                    <div className="col-start-2 grid content-start gap-1 bg-accent/10 px-4 py-3.5 md:col-start-auto">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent md:hidden">
                        v2
                      </span>
                      <b className="font-bold">
                        {s.name === "Resultado" ? "Verificación" : s.name}
                      </b>
                      <span className="text-sm text-muted">{s.v2}</span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="comparacion" className="grid gap-8">
          <SectionHead id="comparacion" label="Comparación" title="Diferencias punto por punto" />
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-panel">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.12em]">
                  <th className="px-4 py-3 font-semibold text-subtle">Tema</th>
                  <th className="px-4 py-3 font-semibold text-warn">v1</th>
                  <th className="px-4 py-3 font-semibold text-accent">v2</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([topic, v1, v2]) => (
                  <tr key={topic} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">{topic}</td>
                    <td className="px-4 py-3 text-muted">{v1}</td>
                    <td className="px-4 py-3 text-muted">{v2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted">
          <span>EV-on-way · planificación energética de viajes en vehículo eléctrico.</span>
          <div className="flex flex-wrap gap-3">
            <EngineButton engine="v1">Planificador v1</EngineButton>
            <EngineButton engine="v2">Planificador v2</EngineButton>
          </div>
        </footer>
      </div>
    </main>
  );
}
