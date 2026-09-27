import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GuideContent } from "./content";
import { FlowSteps } from "./flow-steps";
import { GuideSimulator } from "./guide-simulator";
import { ActorLegend, ENGINE_TONE, Eyebrow, SectionHead } from "./primitives";
import { SequenceDiagram } from "./sequence-diagram";

/** Guía "Cómo funciona" de un motor: demo, secuencia, flujo paso a paso y endpoints. */
export function EngineGuide({ content }: { content: GuideContent }) {
  const { engine } = content;
  const other = engine === "v1" ? "v2" : "v1";
  const tone = ENGINE_TONE[engine];

  return (
    <main className="relative z-20 h-dvh overflow-y-auto pt-14">
      <div className="mx-auto grid max-w-5xl gap-16 px-4 pb-20 pt-6 md:px-8 md:pt-8">
        <nav aria-label="Guías" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href="/" className="inline-flex items-center gap-1.5 text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Inicio
          </Link>
          <Link href={`/${other}/como-funciona`} className="text-muted hover:text-fg">
            Cómo funciona {other}
          </Link>
        </nav>

        <header className="grid gap-5">
          <Eyebrow className={tone.text}>{content.eyebrow}</Eyebrow>
          <h1 className="max-w-[22ch] text-[clamp(2rem,4.6vw,3.2rem)] font-extrabold leading-[1.05] tracking-[-0.02em]">
            {content.title}
          </h1>
          <p className="max-w-[68ch] text-lg text-muted">{content.lead}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {content.pills.map((pill, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  i === 0 ? cn(tone.border, tone.text) : "border-border bg-surface text-fg",
                )}
              >
                {pill}
              </li>
            ))}
          </ul>
          <Link
            href={`/${engine}`}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 justify-self-start rounded-md px-4 text-sm font-semibold transition hover:brightness-110",
              tone.bg,
              tone.onBg,
            )}
          >
            Abrir el planificador {engine} <ArrowRight className="size-4" />
          </Link>
        </header>

        <section aria-labelledby="demo" className="grid gap-6">
          <SectionHead
            id="demo"
            label="Demo interactiva"
            title={`Prueba el planificador ${engine} con el ejemplo`}
          >
            {content.simulatorIntro}
          </SectionHead>
          <GuideSimulator engine={engine} />
        </section>

        <section aria-labelledby="secuencia" className="grid gap-6">
          <SectionHead id="secuencia" label="Vista general" title="Quién llama a quién" />
          <SequenceDiagram participants={content.participants} items={content.sequence} />
          <ActorLegend provider={content.providerLegend} />
        </section>

        <section aria-labelledby="flujo" className="grid gap-6">
          <SectionHead
            id="flujo"
            label="Paso a paso"
            title={`El flujo completo con el motor ${engine}`}
          />
          <FlowSteps steps={content.steps} />
        </section>

        <section aria-labelledby="endpoints" className="grid gap-6">
          <SectionHead id="endpoints" label="Resumen" title={`Endpoints que consume ${engine}`} />
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-panel">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-subtle">
                  <th className="px-4 py-3 font-semibold">Proveedor</th>
                  <th className="px-4 py-3 font-semibold">Endpoint</th>
                  <th className="px-4 py-3 font-semibold">Cuándo</th>
                  <th className="px-4 py-3 font-semibold">Caché</th>
                </tr>
              </thead>
              <tbody>
                {content.endpoints.map(([provider, endpoint, when, cache], i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">{provider}</td>
                    <td className="px-4 py-3">{endpoint}</td>
                    <td className="px-4 py-3 text-muted">{when}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{cache}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {content.comparison ? (
          <section aria-labelledby="cambios" className="grid gap-6">
            <SectionHead id="cambios" label="Comparación" title="Qué cambia en v2" />
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
                  {content.comparison.map(([topic, v1, v2]) => (
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
        ) : null}

        <footer className="grid gap-4 border-t border-border pt-6 text-sm text-muted">
          <p className="max-w-[80ch]">Fuente en el código: {content.sources}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href={`/${engine}`} className={cn("font-semibold hover:underline", tone.text)}>
              Abrir el planificador {engine} →
            </Link>
            <Link href={`/${other}/como-funciona`} className="hover:text-fg">
              Cómo funciona {other} →
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
