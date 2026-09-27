"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, RefreshCw, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  resetStationDatasetMemory,
  stationDatasetQueryOptions,
} from "@/components/stations/use-station-dataset";
import { diagnosticLines } from "@/lib/diagnostics";
import { deleteCachedDataset } from "@/lib/station-dataset-cookies";
import { usePlanner } from "@/lib/store";
import { appInfoFn, clearServerCacheFn } from "@/server/actions/cache";

/**
 * "Diagnóstico y caché": qué versión y configuración responde y con qué se
 * calculó el plan (para comparar entornos, p. ej. localhost contra Vercel), y
 * un botón que limpia la caché y vuelve a planificar.
 *  - Navegador: listado de electrolineras (cookie, memoria y consultas) y el
 *    plan en pantalla. Las preferencias (vehículo, condiciones, motor) quedan.
 *  - Servidor (solo administradores): rutas, clima, Blaze y demás respuestas
 *    con vencimiento. La elevación se conserva: no cambia y cuesta pedirla.
 */
export function CacheTools({ onReplan }: { onReplan: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { data: info } = useQuery({
    queryKey: ["app-info"],
    queryFn: () => appInfoFn(),
    enabled: open,
    staleTime: 60_000,
  });
  const engineChoice = usePlanner((s) => s.engineChoice);
  const geo = usePlanner((s) => s.geo);
  const plan = usePlanner(
    (s) => s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0] ?? null,
  );
  const vehicle = usePlanner((s) => s.selectedVehicle());
  const conditions = usePlanner((s) => s.conditions);
  const lines = diagnosticLines({ info, engineChoice, geo, plan, vehicle, conditions });

  async function clearAndReplan() {
    setBusy(true);
    const cleared: string[] = ["navegador"];
    try {
      if (info?.canClearServer) {
        try {
          await clearServerCacheFn();
          cleared.push("servidor");
        } catch (err) {
          toast.error(
            `No se pudo limpiar la caché del servidor: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      deleteCachedDataset();
      resetStationDatasetMemory();
      queryClient.removeQueries({ queryKey: ["stations"] });
      queryClient.removeQueries({ queryKey: ["station-detail"] });
      queryClient.removeQueries({ queryKey: ["reverse-place"] });
      queryClient.removeQueries({ queryKey: ["app-info"] });
      const s = usePlanner.getState();
      const hadTrip = Boolean(s.origin && s.destination);
      s.clearResult();
      // Listado fresco antes de volver a planificar (el botón de planificar lo espera).
      await queryClient.fetchQuery(stationDatasetQueryOptions(s.engineChoice));
      toast.success(
        `Caché limpia (${cleared.join(" y ")}).${hadTrip ? " Recalculando el viaje…" : ""}`,
      );
      if (hadTrip) onReplan();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo limpiar la caché");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Diagnóstico copiado");
    } catch {
      toast.error("No se pudo copiar; selecciona el texto a mano");
    }
  }

  return (
    <div className="rounded-md border border-border bg-bg-elevated">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-muted hover:text-fg"
      >
        <span className="flex items-center gap-2">
          <Stethoscope className="size-4" /> Diagnóstico y caché
        </span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-muted">
            {lines.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={clearAndReplan} disabled={busy}>
              <RefreshCw className={busy ? "animate-spin" : undefined} />
              {info?.canClearServer ? "Limpiar caché (navegador y servidor)" : "Limpiar caché"}
            </Button>
            <Button size="sm" variant="ghost" onClick={copy}>
              <Copy /> Copiar
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-subtle">
            Limpia el listado de electrolineras y el plan en pantalla, y vuelve a planificar. Tus
            preferencias (vehículo, condiciones y motor) se conservan: son de este navegador, así
            que pueden ser distintas en otro dominio (p. ej. localhost y Vercel).
          </p>
        </div>
      ) : null}
    </div>
  );
}
