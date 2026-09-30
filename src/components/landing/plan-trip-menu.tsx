"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  {
    href: "/v2",
    engine: "v2",
    title: "Programación dinámica",
    tag: "Nuevo",
    note: "Física por tramo, estaciones en vivo y paradas óptimas.",
  },
  {
    href: "/v1",
    engine: "v1",
    title: "Por puntaje",
    tag: "Clásico",
    note: "El motor original: elige la mejor estación, una a la vez.",
  },
] as const;

/**
 * "Planificar mi viaje" del landing: abre un menú para elegir el motor (v2 o
 * v1) y lleva a su planificador. Menú de Radix: se maneja con teclado.
 */
export function PlanTripMenu({ className }: { className?: string }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={cn(
          "landing-gradient-bg group inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-[#04221c] shadow-[0_10px_30px_-10px_rgb(47_206_187/0.6)] outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          className,
        )}
      >
        Planificar mi viaje
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 grid w-[max(22rem,var(--radix-dropdown-menu-trigger-width))] max-w-[calc(100vw-2rem)] gap-1 rounded-2xl border border-border-strong bg-surface p-1.5 shadow-float"
        >
          <DropdownMenu.Label className="px-3 pb-1 pt-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-subtle">
            Elige el motor de cálculo
          </DropdownMenu.Label>
          {OPTIONS.map((o) => (
            <DropdownMenu.Item key={o.engine} asChild>
              <Link
                href={o.href}
                className="group flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none transition data-[highlighted]:bg-surface-2"
              >
                <span
                  className={cn(
                    "mt-0.5 font-mono text-lg font-extrabold leading-none",
                    o.engine === "v2" ? "landing-gradient-text" : "text-warn",
                  )}
                >
                  {o.engine}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {o.title}
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
                        o.engine === "v2"
                          ? "border-accent/40 text-accent"
                          : "border-warn/40 text-warn",
                      )}
                    >
                      {o.tag}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{o.note}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-subtle transition group-data-[highlighted]:translate-x-0.5 group-data-[highlighted]:text-fg" />
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
