import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ACTOR_TONE, type Actor } from "./primitives";

/** Una línea de un bloque de endpoints: método, URL (puede ocupar varias líneas) y comentario. */
export type EndpointLine = { method?: string; url: string; note?: string };

export type KeyValue = { title: ReactNode; items: ReactNode[] };

export type StepBlock =
  | { kind: "columns"; columns: KeyValue[] }
  | { kind: "list"; list: KeyValue }
  | { kind: "endpoints"; lines: EndpointLine[] }
  | { kind: "text"; text: ReactNode };

export type FlowStep = { actor: Actor; who: string; title: string; blocks: StepBlock[] };

function KeyValueList({ kv }: { kv: KeyValue }) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <h4 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">
        {kv.title}
      </h4>
      <ul className="m-0 grid gap-1 pl-4 marker:text-subtle">
        {kv.items.map((item, i) => (
          <li key={i} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Endpoints({ lines }: { lines: EndpointLine[] }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-md bg-bg-elevated px-3 py-2.5 font-mono text-[12px] leading-relaxed text-fg">
      {lines.map((l, i) => (
        <span key={i} className="block">
          {l.method ? (
            <span className="font-semibold text-accent">{l.method.padEnd(5)}</span>
          ) : null}
          {l.url}
          {l.note ? <span className="text-subtle">{`   # ${l.note}`}</span> : null}
        </span>
      ))}
    </pre>
  );
}

export function FlowSteps({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0">
      {steps.map((step, i) => (
        <li
          key={step.title}
          className="grid grid-cols-[2.25rem_1fr] gap-x-3 rounded-xl border border-border bg-surface p-4 shadow-panel md:grid-cols-[2.5rem_1fr] md:p-5"
        >
          <span
            className={cn(
              "grid size-8 place-items-center rounded-md font-mono text-sm font-bold tabular-nums text-bg md:size-9",
              ACTOR_TONE[step.actor].bg,
            )}
          >
            {i + 1}
          </span>
          <div className="grid min-w-0 gap-3">
            <div className="grid gap-0.5">
              <span
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.08em]",
                  ACTOR_TONE[step.actor].text,
                )}
              >
                {step.who}
              </span>
              <h3 className="text-lg font-bold leading-snug tracking-tight">{step.title}</h3>
            </div>
            {step.blocks.map((b, j) =>
              b.kind === "columns" ? (
                <div key={j} className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {b.columns.map((kv, k) => (
                    <KeyValueList key={k} kv={kv} />
                  ))}
                </div>
              ) : b.kind === "list" ? (
                <KeyValueList key={j} kv={b.list} />
              ) : b.kind === "endpoints" ? (
                <Endpoints key={j} lines={b.lines} />
              ) : (
                <p key={j} className="max-w-[72ch] text-sm text-muted">
                  {b.text}
                </p>
              ),
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
