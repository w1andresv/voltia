import Link from "next/link";
import {
  ArrowRight,
  CarFront,
  ChevronDown,
  CloudOff,
  Columns3,
  Mountain,
  PlugZap,
  Route,
  Share2,
} from "lucide-react";
import { formatElevation, formatKm, formatMinutes, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BrandMark, BrandName } from "@/components/brand/brand";
import { GuideLink } from "@/components/guide/guide-link";
import { BUC_BOG } from "./bucaramanga-bogota";
import { ElevationSpark, OfflineNotice, StationChips } from "./feature-visuals";
import { HeroTripCard } from "./hero-trip-card";
import { RouteProfile } from "./route-profile";

/**
 * Landing en "/": qué resuelve EV-on-way para quien viaja en eléctrico por
 * Colombia, con un viaje real de ejemplo (Bucaramanga → Bogotá, calculado con
 * el planificador). "Planificar" va a /planificar, que abre el motor que el
 * servidor tenga por defecto; los dos motores siguen a mano más abajo.
 * Solo se anuncian funciones que existen en la app.
 */

/**
 * Tres filas completas en escritorio: cada fila tiene una tarjeta ancha (con
 * su visual) y una angosta, alternando el lado.
 */
const FEATURES: {
  icon: React.ReactNode;
  title: string;
  body: string;
  visual?: React.ReactNode;
}[] = [
  {
    icon: <Mountain className="size-5" />,
    title: "La física de cada tramo",
    body: "Aire, rodadura, pendiente y aceleración cada 100 m, con la altura real del terreno, el viento y la temperatura. En las bajadas, la regeneración te devuelve energía.",
    visual: <ElevationSpark />,
  },
  {
    icon: <Route className="size-5" />,
    title: "Paradas óptimas",
    body: "Compara todas las combinaciones de paradas y cuánto cargar en cada una, y revisa el plan con la ruta real que pasa por las estaciones.",
  },
  {
    icon: <Columns3 className="size-5" />,
    title: "Compara vehículos",
    body: "Tu carro y hasta dos más, lado a lado en la misma ruta: tiempo, paradas, energía y batería al llegar.",
  },
  {
    icon: <PlugZap className="size-5" />,
    title: "Electrolineras reales",
    body: "Red de carga con estado en vivo. Si el conector no coincide con el de tu carro, te dice qué adaptador necesitas.",
    visual: <StationChips />,
  },
  {
    icon: <CloudOff className="size-5" />,
    title: "Sin señal, sin problema",
    body: "Instálala en el celular. Tu último plan queda guardado y lo abres aunque no haya internet.",
    visual: <OfflineNotice />,
  },
  {
    icon: <Share2 className="size-5" />,
    title: "Guarda, comparte y navega",
    body: "Guarda tus viajes, compártelos por link y abre la ruta en Google Maps, Waze o Apple Maps.",
  },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Elige tu carro",
    body: "Del catálogo, con fichas de MG, Tesla, Volvo y Changan y la fuente de cada cifra, o crea el tuyo con sus datos.",
  },
  {
    title: "Marca origen y destino",
    body: "Escribe el lugar o tócalo en el mapa. Te muestra rutas alternativas, incluida una sin peajes.",
  },
  {
    title: "Sal con el plan",
    body: "Dónde parar, cuánto cargar y la batería en cada kilómetro. Si no alcanza, te dice con cuánto salir.",
  },
];

const ENGINES: {
  id: "v1" | "v2";
  tag: string;
  title: string;
  facts: string[];
}[] = [
  {
    id: "v2",
    tag: "Nuevo",
    title: "Programación dinámica",
    facts: [
      "Física tramo a tramo: aire, rodadura, pendiente y aceleración.",
      "Electrolineras con estado en vivo, actualizadas cada 15 min.",
      "Todas las combinaciones de paradas y cargas, verificadas con la ruta real.",
    ],
  },
  {
    id: "v1",
    tag: "Clásico",
    title: "Por puntaje",
    facts: [
      "Consumo base ajustado por estilo de manejo y clima.",
      "Mapa de electrolineras propio, con aportes de la comunidad.",
      "Elige la mejor estación, una a la vez.",
    ],
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
    "Lo óptimo; en carga rápida 10 puntos extra si hay otra parada después, hasta 90 % o el tope del vehículo",
  ],
  [
    "Si no alcanza",
    "Carga previa para llegar a la primera estación",
    "Con cuánto salir y en qué km se agota la batería",
  ],
  ["Verificación", "—", "Revisa las paradas elegidas y recalcula con la ruta real"],
];

function PrimaryCta({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Link
      href="/planificar"
      className={cn(
        "landing-gradient-bg group inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-[#04221c] shadow-[0_10px_30px_-10px_rgb(47_206_187/0.6)] transition hover:brightness-110",
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
      {children}
    </span>
  );
}

function SectionHead({
  id,
  eyebrow,
  title,
  children,
  center,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("landing-reveal grid gap-3", center && "justify-items-center text-center")}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="max-w-[22ch] text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] md:text-5xl"
      >
        {title}
      </h2>
      {children ? <p className="max-w-[60ch] text-base text-muted md:text-lg">{children}</p> : null}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="grid content-start gap-1 bg-bg-elevated px-4 py-5 sm:px-6">
      <span className="text-2xl font-extrabold tabular-nums tracking-tight md:text-3xl">
        {value}
      </span>
      <span className="text-xs text-muted md:text-sm">{label}</span>
    </div>
  );
}

export function Landing() {
  const d = BUC_BOG;
  return (
    <main className="relative z-20 h-dvh overflow-y-auto overflow-x-hidden bg-bg pt-14">
      {/* Portada */}
      <section aria-labelledby="titulo" className="relative isolate">
        <div aria-hidden className="landing-glow absolute inset-0 -z-10" />
        <div aria-hidden className="landing-grid absolute inset-0 -z-10 opacity-60" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div className="grid gap-7">
            <span
              className="landing-rise inline-flex items-center gap-2 justify-self-start rounded-full border border-border-strong bg-surface/60 px-3 py-1.5 text-xs text-muted backdrop-blur"
              style={{ "--landing-delay": "0s" } as React.CSSProperties}
            >
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
              Planificador de viajes en vehículo eléctrico · Colombia
            </span>
            <h1
              id="titulo"
              className="landing-rise text-[clamp(2.7rem,6.4vw,4.6rem)] font-extrabold leading-[0.95] tracking-[-0.045em]"
              style={{ "--landing-delay": "0.08s" } as React.CSSProperties}
            >
              De la cordillera al <span className="landing-gradient-text">plan de carga.</span>
            </h1>
            <p
              className="landing-rise max-w-[46ch] text-lg leading-relaxed text-muted md:text-xl"
              style={{ "--landing-delay": "0.16s" } as React.CSSProperties}
            >
              Cuánta batería gasta tu carro en cada subida y bajada, dónde parar y cuánto cargar,
              con electrolineras reales.{" "}
              <span className="text-fg">Antes de salir, no en la carretera.</span>
            </p>
            <div
              className="landing-rise flex flex-wrap items-center gap-3"
              style={{ "--landing-delay": "0.24s" } as React.CSSProperties}
            >
              <PrimaryCta className="w-full sm:w-auto">Planificar mi viaje</PrimaryCta>
              <a
                href="#ejemplo"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-border-strong px-5 text-sm font-semibold text-fg transition hover:bg-surface-2 sm:w-auto"
              >
                Ver un viaje real
              </a>
            </div>
            <p
              className="landing-rise text-xs text-subtle"
              style={{ "--landing-delay": "0.32s" } as React.CSSProperties}
            >
              Sin crear cuenta · Se instala en el celular
            </p>
          </div>
          <div
            className="landing-rise lg:pl-4"
            style={{ "--landing-delay": "0.2s" } as React.CSSProperties}
          >
            <HeroTripCard />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-24 px-4 pb-16 md:gap-32 md:px-8">
        {/* Cifras del viaje de ejemplo */}
        <section aria-label="El viaje de ejemplo en cifras" className="landing-reveal">
          <p className="mb-4 text-center text-sm text-muted">
            Bucaramanga → Bogotá con un {d.vehicle}, calculado kilómetro a kilómetro
          </p>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
            <Stat value={formatKm(d.distanceKm)} label="por carretera" />
            <Stat value={`+${formatElevation(d.gainM)}`} label="de subida acumulada" />
            <Stat
              value={`${d.stops.length} paradas`}
              label={`${formatMinutes(d.chargeMinutes)} cargando`}
            />
            <Stat value={formatPct(d.arrivalSoc)} label="de batería al llegar" />
          </div>
        </section>

        {/* Funciones */}
        <section aria-labelledby="funciones" className="grid gap-10">
          <SectionHead
            id="funciones"
            eyebrow="Por qué EV-on-way"
            title={
              <>
                Lo que la autonomía de la ficha{" "}
                <span className="landing-gradient-text">no te dice</span>
              </>
            }
          >
            La autonomía anunciada se mide en plano. En Colombia hay cordillera, calor, frío y
            estaciones que no siempre funcionan: EV-on-way las tiene en cuenta.
          </SectionHead>
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className={cn(
                  "landing-reveal group relative grid content-start gap-6 overflow-hidden rounded-2xl border border-border bg-surface/70 p-6 backdrop-blur transition hover:border-border-strong",
                  f.visual && "md:col-span-2 md:grid-cols-[1fr_1fr] md:items-center md:gap-8",
                )}
              >
                <div
                  aria-hidden
                  className="landing-gradient-bg pointer-events-none absolute -right-16 -top-16 size-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-20"
                />
                <div className="grid content-start gap-4">
                  <span className="grid size-11 place-items-center rounded-xl bg-accent/12 text-accent ring-1 ring-accent/25">
                    {f.icon}
                  </span>
                  <div className="grid gap-2">
                    <h3 className="text-lg font-bold tracking-tight">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted">{f.body}</p>
                  </div>
                </div>
                {f.visual ?? null}
              </article>
            ))}
          </div>
        </section>

        {/* Cómo funciona */}
        <section aria-labelledby="pasos" className="grid gap-10">
          <SectionHead id="pasos" eyebrow="Cómo funciona" title="Tres pasos, un plan completo" />
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="landing-reveal relative grid content-start gap-3 rounded-2xl border border-border bg-surface/50 p-6"
              >
                <span className="landing-gradient-text font-mono text-4xl font-extrabold leading-none tracking-tight">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-bold tracking-tight">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Ejemplo real */}
        <section aria-labelledby="ejemplo" className="grid scroll-mt-20 gap-10">
          <SectionHead
            id="ejemplo"
            eyebrow="Ejemplo real"
            title="Bucaramanga → Bogotá, kilómetro a kilómetro"
          >
            El cañón del Chicamocha, la subida a Tunja y dos cargas rápidas. Calculado con el
            planificador sobre la carretera real, con la altura del terreno cada 100 m.
          </SectionHead>
          <div className="landing-reveal">
            <RouteProfile />
          </div>
        </section>

        {/* Motores */}
        <section aria-labelledby="motores" className="grid gap-10">
          <SectionHead id="motores" eyebrow="Bajo el capó" title="Dos motores de cálculo">
            Los dos reciben el mismo vehículo, las mismas condiciones y la misma ruta. El v2 es el
            nuevo: física por tramo, estaciones en vivo y paradas óptimas.
          </SectionHead>
          <div className="grid gap-4 md:grid-cols-2">
            {ENGINES.map((e) => (
              <article
                key={e.id}
                className={cn(
                  "landing-reveal grid content-start gap-5 rounded-2xl border border-border bg-surface/70 p-6",
                  e.id === "v2" && "landing-ring border-transparent",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "font-mono text-3xl font-extrabold tracking-tight",
                      e.id === "v2" ? "landing-gradient-text" : "text-warn",
                    )}
                  >
                    {e.id}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
                      e.id === "v2" ? "border-accent/40 text-accent" : "border-warn/40 text-warn",
                    )}
                  >
                    {e.tag}
                  </span>
                </div>
                <h3 className="text-xl font-bold tracking-tight">{e.title}</h3>
                <ul className="m-0 grid list-none gap-2.5 p-0">
                  {e.facts.map((fact) => (
                    <li key={fact} className="flex gap-2.5 text-sm text-muted">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-2 size-1.5 shrink-0 rounded-full",
                          e.id === "v2" ? "bg-accent" : "bg-warn",
                        )}
                      />
                      {fact}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-1">
                  <Link
                    href={`/${e.id}`}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition",
                      e.id === "v2"
                        ? "bg-accent text-accent-fg hover:brightness-110"
                        : "border border-warn/50 text-warn hover:bg-warn/10",
                    )}
                  >
                    Abrir planificador {e.id}
                    <ArrowRight className="size-4" />
                  </Link>
                  <GuideLink
                    href={`/${e.id}/como-funciona`}
                    className={cn(
                      "text-sm font-semibold hover:underline",
                      e.id === "v2" ? "text-accent" : "text-warn",
                    )}
                  >
                    Cómo funciona {e.id} →
                  </GuideLink>
                </div>
              </article>
            ))}
          </div>
          <details className="landing-reveal group rounded-2xl border border-border bg-surface/50">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-6 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Diferencias punto por punto
              <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-[0.12em]">
                    <th className="px-6 py-3 font-semibold text-subtle">Tema</th>
                    <th className="px-6 py-3 font-semibold text-warn">v1</th>
                    <th className="px-6 py-3 font-semibold text-accent">v2</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([topic, v1, v2]) => (
                    <tr key={topic} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-6 py-3 font-semibold">{topic}</td>
                      <td className="px-6 py-3 text-muted">{v1}</td>
                      <td className="px-6 py-3 text-muted">{v2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        {/* Llamado final */}
        <section
          aria-labelledby="empezar"
          className="landing-reveal landing-ring relative isolate overflow-hidden rounded-3xl bg-surface/70 px-6 py-14 text-center md:px-12 md:py-20"
        >
          <div aria-hidden className="landing-glow absolute inset-0 -z-10 opacity-90" />
          <div className="mx-auto grid max-w-2xl justify-items-center gap-5">
            <CarFront className="size-8 text-accent" aria-hidden />
            <h2
              id="empezar"
              className="text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] md:text-5xl"
            >
              Tu próximo viaje, <span className="landing-gradient-text">sin adivinar</span> la
              batería.
            </h2>
            <p className="max-w-[48ch] text-muted md:text-lg">
              Elige el carro, marca el destino y sal sabiendo dónde vas a cargar.
            </p>
            <PrimaryCta className="mt-2">Planificar mi viaje</PrimaryCta>
          </div>
        </section>

        <footer className="grid gap-6 border-t border-border pt-8 text-sm text-muted md:grid-cols-[1fr_auto] md:items-start">
          <div className="grid gap-3">
            <div className="flex items-center gap-2.5">
              <BrandMark className="size-8" />
              <BrandName className="text-lg" />
            </div>
            <p className="max-w-[56ch] text-xs leading-relaxed text-subtle">
              Planificación energética de viajes en vehículo eléctrico. Los cálculos son
              estimaciones: tu viaje puede variar según el día, el clima y las estaciones
              disponibles.
            </p>
          </div>
          <nav aria-label="Planificadores" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/planificar" className="hover:text-fg">
              Planificar
            </Link>
            <Link href="/v2" className="hover:text-fg">
              Planificador v2
            </Link>
            <Link href="/v1" className="hover:text-fg">
              Planificador v1
            </Link>
            <a href="#ejemplo" className="hover:text-fg">
              Viaje de ejemplo
            </a>
          </nav>
        </footer>
      </div>
    </main>
  );
}
