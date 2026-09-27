"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { engineChoiceFn } from "@/server/actions/plan";
import { useUserContext } from "@/components/user/user-context";
import { plannerHref } from "@/lib/planner-routes";
import { usePlanner } from "@/lib/store";

/**
 * Selector de motor v1/v2. Cada motor tiene su ruta (/v1 y /v2): elegir uno
 * navega a la suya, y el planificador vuelve a calcular si ya había una ruta.
 * Aparece para todos, salvo que ENGINE_PREVIEW_EMAILS lo limite a una lista de
 * correos; el servidor vuelve a comprobarlo en la página y al planificar.
 *  - v1: planificador y energía actuales.
 *  - v2: planificador por programación dinámica y energía física con perfil
 *    de velocidad (F5, F7).
 */
export function EngineSwitch() {
  const router = useRouter();
  const { context } = useUserContext();
  const userKey = context?.kind === "authenticated" ? context.userId : "guest";
  const { data } = useQuery({
    queryKey: ["engine-choice", userKey],
    queryFn: () => engineChoiceFn(),
    // Invitados también: el servidor decide (ENGINE_PREVIEW_EMAILS="*" lo abre a todos).
    enabled: context != null,
    staleTime: Infinity,
  });
  const choice = usePlanner((s) => s.engineChoice) ?? "v1";
  if (!data?.allowed) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
        <FlaskConical className="size-4 shrink-0" />
        <span className="truncate">
          Motor de cálculo ·{" "}
          <Link href="/#motores" className="underline underline-offset-2 hover:text-fg">
            ¿qué cambia?
          </Link>
        </span>
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
            onClick={() => {
              if (v !== choice) router.push(plannerHref(v));
            }}
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
