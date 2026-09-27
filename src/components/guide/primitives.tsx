import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Colores de cada motor en las guías y el landing: v1 ámbar (warn), v2 el acento de la app. */
export const ENGINE_TONE = {
  v1: {
    text: "text-warn",
    bg: "bg-warn",
    soft: "bg-warn/12",
    border: "border-warn/40",
    onBg: "text-bg",
  },
  v2: {
    text: "text-accent",
    bg: "bg-accent",
    soft: "bg-accent/12",
    border: "border-accent/40",
    onBg: "text-accent-fg",
  },
} as const;

/** Quién actúa en cada paso o mensaje: navegador, servidor de EV-on-way o un proveedor externo. */
export type Actor = "browser" | "server" | "provider";

export const ACTOR_TONE: Record<Actor, { text: string; bg: string; label: string }> = {
  browser: { text: "text-info", bg: "bg-info", label: "Navegador" },
  server: { text: "text-ok", bg: "bg-ok", label: "Servidor EV-on-way (Next.js, server actions)" },
  provider: { text: "text-muted", bg: "bg-subtle", label: "Proveedor externo o base de datos" },
};

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1 py-px font-mono text-[0.86em]">{children}</code>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-subtle",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionHead({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Eyebrow>{label}</Eyebrow>
      <h2 id={id} className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
        {title}
      </h2>
      {children ? <p className="max-w-[68ch] text-muted">{children}</p> : null}
    </div>
  );
}

export function ActorLegend({
  provider = "Proveedor externo o base de datos",
}: {
  provider?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {(["browser", "server", "provider"] as const).map((a) => (
        <span key={a} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", ACTOR_TONE[a].bg)} />
          {a === "provider" ? provider : ACTOR_TONE[a].label}
        </span>
      ))}
    </div>
  );
}
