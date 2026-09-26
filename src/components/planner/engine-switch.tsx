"use client";

import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { engineChoiceFn } from "@/server/actions/plan";
import { useUserContext } from "@/components/user/user-context";
import { usePlanner } from "@/lib/store";

/**
 * Selector de motor v1/v2 (vista previa). Solo aparece para los correos en
 * ENGINE_PREVIEW_EMAILS; el servidor vuelve a comprobarlo al planificar.
 *  - v1: planificador y energía actuales.
 *  - v2: planificador por programación dinámica y energía física con perfil
 *    de velocidad (F5, F7).
 * Si ya hay una ruta calculada, cambiar el motor vuelve a planificar.
 */
export function EngineSwitch({ onChange }: { onChange?: (choice: "v1" | "v2") => void }) {
  const { context } = useUserContext();
  const userKey = context?.kind === "authenticated" ? context.userId : "guest";
  const { data } = useQuery({
    queryKey: ["engine-choice", userKey],
    queryFn: () => engineChoiceFn(),
    enabled: context?.kind === "authenticated",
    staleTime: Infinity,
  });
  const choice = usePlanner((s) => s.engineChoice) ?? "v1";
  const setChoice = usePlanner((s) => s.setEngineChoice);
  if (!data?.allowed) return null;

  const pick = (next: "v1" | "v2") => {
    if (next === choice) return;
    setChoice(next);
    onChange?.(next);
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <FlaskConical className="size-4 shrink-0" />
        <span className="truncate">Motor de cálculo (vista previa)</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Motor de cálculo"
        className="flex shrink-0 rounded-md bg-surface-2 p-0.5"
      >
        {(["v1", "v2"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={choice === v}
            onClick={() => pick(v)}
            className={`h-8 rounded px-3 text-xs font-medium transition-colors ${
              choice === v ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
            title={
              v === "v1"
                ? "Planificador y consumo actuales"
                : "Planificador nuevo y consumo con física por tramo y perfil de velocidad"
            }
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
