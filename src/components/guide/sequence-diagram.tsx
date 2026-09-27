import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { ACTOR_TONE, type Actor } from "./primitives";

export type Participant = { id: string; label: string; actor: Actor | "user" };

export type SequenceItem =
  | { from: string; to: string; text: string; reply?: boolean }
  | { note: string; over: [string, string?] };

/**
 * Diagrama de secuencia en HTML: una columna por participante con su línea de
 * vida y una fila por mensaje. Sustituye a mermaid (la CSP de la app no deja
 * cargar scripts de terceros).
 */
export function SequenceDiagram({
  participants,
  items,
}: {
  participants: Participant[];
  items: SequenceItem[];
}) {
  const col = (id: string) => {
    const i = participants.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`Participante desconocido: ${id}`);
    return i;
  };
  const cols = participants.length;
  const grid = { gridTemplateColumns: `2rem repeat(${cols}, minmax(6.5rem, 1fr))` };
  let n = 0;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4 shadow-panel">
      <div className="relative grid gap-y-1" style={{ ...grid, minWidth: `${2 + cols * 6.5}rem` }}>
        {/* Líneas de vida */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid" style={grid}>
          <span />
          {participants.map((p) => (
            <span
              key={p.id}
              className="mx-auto h-full w-px border-l border-dashed border-border-strong"
            />
          ))}
        </div>

        <span />
        {participants.map((p) => (
          <div key={p.id} className="relative z-10 flex justify-center px-1 pb-3">
            <span
              className={cn(
                "rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-center text-xs font-semibold leading-tight",
                p.actor === "user" ? "text-fg" : ACTOR_TONE[p.actor].text,
              )}
            >
              {p.label}
            </span>
          </div>
        ))}

        {items.map((item, i) => {
          if ("note" in item) {
            const a = col(item.over[0]);
            const b = col(item.over[1] ?? item.over[0]);
            // Sobre un solo participante la nota se abre a sus vecinos para no quedar angosta.
            const lo = a === b ? Math.max(0, a - 1) : Math.min(a, b);
            const hi = a === b ? Math.min(cols - 1, a + 1) : Math.max(a, b);
            return (
              <Fragment key={i}>
                <span style={{ gridColumn: 1 }} />
                <div
                  className="relative z-10 my-1 rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-center text-xs text-fg"
                  style={{ gridColumn: `${lo + 2} / ${hi + 3}` }}
                >
                  {item.note}
                </div>
              </Fragment>
            );
          }
          n += 1;
          const from = col(item.from);
          const to = col(item.to);
          const self = from === to;
          const lo = Math.min(from, to);
          // Un mensaje a sí mismo usa también la columna de la derecha para el texto.
          const hi = self ? Math.min(cols - 1, from + 1) : Math.max(from, to);
          const span = hi - lo + 1;
          const inset = `calc(100% / ${span} / 2)`;
          return (
            <Fragment key={i}>
              <span
                className="relative z-10 self-end pb-0.5 text-right font-mono text-[11px] tabular-nums text-subtle"
                style={{ gridColumn: 1 }}
              >
                {n}
              </span>
              <div
                className="relative z-10 flex min-h-11 flex-col justify-end"
                style={{ gridColumn: `${lo + 2} / ${hi + 3}` }}
              >
                {self ? (
                  <div className="flex items-end gap-2 pb-0.5" style={{ marginLeft: inset }}>
                    <span className="h-5 w-4 shrink-0 rounded-r-md border-y border-r border-fg/60" />
                    <span className="text-xs leading-snug text-fg">{item.text}</span>
                  </div>
                ) : (
                  <>
                    <p
                      className="px-1 pb-3 pt-1 text-center text-xs leading-snug text-fg"
                      style={{ marginLeft: inset, marginRight: inset }}
                    >
                      {item.text}
                    </p>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute bottom-1.5 border-t border-fg/60",
                        item.reply ? "border-dashed" : "border-solid",
                      )}
                      style={{ left: inset, right: inset }}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "absolute bottom-[3px] size-0 border-y-[3.5px] border-y-transparent",
                        to > from
                          ? "border-l-[7px] border-l-fg/60"
                          : "border-r-[7px] border-r-fg/60",
                      )}
                      style={to > from ? { right: inset } : { left: inset }}
                    />
                  </>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
