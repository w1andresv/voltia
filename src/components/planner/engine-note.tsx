"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { usePlanner } from "@/lib/store";

/** Qué motor calcula en esta página (lo fija la URL: /v1 o /v2) y un enlace a su guía. */
export function EngineNote() {
  const engine = usePlanner((s) => s.engineChoice);
  if (!engine) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-muted">
      <FlaskConical className="size-4 shrink-0" />
      <span>
        Motor de cálculo {engine} ·{" "}
        <Link
          href={`/${engine}/como-funciona`}
          className="underline underline-offset-2 hover:text-fg"
        >
          cómo funciona
        </Link>
      </span>
    </p>
  );
}
