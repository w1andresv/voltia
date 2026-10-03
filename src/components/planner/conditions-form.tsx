import { TriangleAlert } from "lucide-react";
import { conditionWarnings } from "@/domain/conditions-advice";
import { MODEL_PARAMETERS } from "@/domain/ev/core/params";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { MODES, usePlanPreviews } from "./use-plan-previews";

/** Superficie de la vía (ADR-0022): "auto" decide con el pronóstico de lluvia. */
const ROAD_SURFACES = [
  { id: "auto", label: "Automática", hint: "Mojada si el pronóstico trae lluvia en la ruta." },
  { id: "dry", label: "Seca", hint: "Ignora la lluvia del pronóstico." },
  {
    id: "wet",
    label: "Mojada",
    hint: "Más resistencia al rodar y limpiaparabrisas: el consumo sube.",
  },
] as const;

/**
 * Ajustes avanzados: estrategia, permitir bajar del margen, temperatura y
 * velocidad media. El estilo de conducción y el margen de seguridad están en el
 * formulario del viaje (TripParams).
 */
export function ConditionsDialog() {
  const open = usePlanner((s) => s.settingsOpen);
  const setOpen = usePlanner((s) => s.setSettingsOpen);
  const c = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const previews = usePlanPreviews(["mode"], open);
  const warnings = conditionWarnings(c);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustes avanzados</DialogTitle>
          <DialogDescription>
            Estrategia, temperatura, vía y velocidad media. El estilo de conducción, el margen de
            seguridad, los pasajeros y el A/C están en el formulario del viaje.
          </DialogDescription>
        </DialogHeader>

        {warnings.length ? (
          <div className="mb-4 grid gap-2" role="status">
            {warnings.map((w) => (
              <p
                key={w.text}
                className={cn(
                  "flex gap-2 rounded-lg px-3 py-2 text-xs",
                  w.level === "danger" ? "bg-danger/15 text-danger" : "bg-warn/10 text-warn",
                )}
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{w.text}</span>
              </p>
            ))}
          </div>
        ) : null}
        {previews ? (
          <p className="mb-3 text-xs text-subtle">
            Debajo de cada opción: cómo cambiaría el plan recomendado de tu viaje actual.
          </p>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Estrategia</h3>
          <div className="grid grid-cols-1 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => patch({ planningMode: m.id })}
                className={`min-h-14 rounded-lg px-3 py-2.5 text-left ${c.planningMode === m.id ? "bg-accent/15" : "hover:bg-surface-2"}`}
              >
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-muted">{m.hint}</div>
                {previews && c.planningMode !== m.id && previews.mode[m.id] ? (
                  <div className="mt-0.5 text-xs text-accent">{previews.mode[m.id]}</div>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Margen</h3>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-bg-elevated px-3 py-2.5">
            <span className="text-sm">Permitir bajar del margen</span>
            <Switch
              checked={c.allowBelowSafety}
              onCheckedChange={(v) => patch({ allowBelowSafety: v })}
            />
          </label>
          <p className="text-xs leading-relaxed text-muted">
            En ruta la batería puede bajar hasta {MODEL_PARAMETERS.planner.belowSafetyFloorPct} %.
            Al destino siempre se llega con el margen de seguridad.
          </p>
        </section>

        <section className="mt-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">
            Clima y velocidad
          </h3>
          <Row
            label="Temperatura (vacío = clima real)"
            value={c.temperatureC == null ? "auto" : `${c.temperatureC}°C`}
          >
            <Slider
              min={-5}
              max={42}
              value={[c.temperatureC ?? 20]}
              onValueChange={([v]) => patch({ temperatureC: v ?? 20 })}
            />
            <Button size="sm" variant="ghost" onClick={() => patch({ temperatureC: null })}>
              Usar clima
            </Button>
          </Row>
          <div className="grid gap-2">
            <Label>Vía</Label>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Superficie de la vía">
              {ROAD_SURFACES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={(c.roadSurface ?? "auto") === r.id}
                  onClick={() => patch({ roadSurface: r.id })}
                  className={`min-h-11 rounded-lg px-2 py-1.5 text-sm ${(c.roadSurface ?? "auto") === r.id ? "bg-accent/15 font-medium" : "bg-bg-elevated hover:bg-surface-2"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted">
              {ROAD_SURFACES.find((r) => r.id === (c.roadSurface ?? "auto"))?.hint}
            </p>
          </div>
          <Row
            label="Velocidad media"
            value={c.avgSpeedKmh == null ? "ruta" : `${c.avgSpeedKmh} km/h`}
          >
            <Slider
              min={50}
              max={130}
              step={5}
              value={[c.avgSpeedKmh ?? 90]}
              onValueChange={([v]) => patch({ avgSpeedKmh: v ?? 90 })}
            />
            <Button size="sm" variant="ghost" onClick={() => patch({ avgSpeedKmh: null })}>
              Usar ruta
            </Button>
          </Row>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted">{value}</span>
      </div>
      {children}
    </div>
  );
}
