import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { conditionWarnings, previewDelta, type PlanPreview } from "@/domain/conditions-advice";
import type { DrivingStyle, PlanningMode, SafetyMode, TripConditions } from "@/domain/types";
import { safetyPct } from "@/domain/types";
import { rankedPlansFor, usePlanner } from "@/lib/store";
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

const STYLES: { id: DrivingStyle; label: string; hint: string }[] = [
  { id: "efficient", label: "Eficiente", hint: "≈ −10 % energía, ~7 % más lenta" },
  { id: "normal", label: "Normal", hint: "Velocidad de la ruta" },
  { id: "sport", label: "Deportiva", hint: "≈ +15 % energía, ~6 % más rápida" },
];

const MARGINS: [SafetyMode, string][] = [
  ["conservative", "Conservador 20%"],
  ["normal", "Normal 15%"],
  ["low", "Bajo 10%"],
  ["custom", "Personalizado"],
];

function toPreview(p: PlanPreview | undefined): PlanPreview | null {
  return p
    ? {
        energyKwh: p.energyKwh,
        totalMinutes: p.totalMinutes,
        stops: p.stops,
        arrivalSoc: p.arrivalSoc,
        feasible: p.feasible,
      }
    : null;
}

/**
 * Vista previa: cómo cambiaría el plan recomendado con cada opción, recalculado
 * sobre las rutas ya encontradas (sin pedir rutas nuevas). Solo con el diálogo
 * abierto y si ya hay un viaje planificado.
 */
function usePreviews(open: boolean) {
  const geo = usePlanner((s) => s.geo);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const vehicles = usePlanner((s) => s.vehicles);
  const selectedVehicleId = usePlanner((s) => s.selectedVehicleId);
  const conditions = usePlanner((s) => s.conditions);
  return useMemo(() => {
    if (!open || !geo?.routes.length || !origin || !destination) return null;
    const inputs = { geo, origin, destination, vehicles, selectedVehicleId, conditions };
    const with_ = (p: Partial<TripConditions>) =>
      toPreview(rankedPlansFor(inputs, { ...conditions, ...p })[0]);
    const current = with_({});
    if (!current) return null;
    const text = (p: Partial<TripConditions>) => {
      const next = with_(p);
      return next ? previewDelta(current, next) : null;
    };
    return {
      mode: Object.fromEntries(MODES.map((m) => [m.id, text({ planningMode: m.id })])) as Record<
        PlanningMode,
        string | null
      >,
      margin: Object.fromEntries(MARGINS.map(([id]) => [id, text({ safetyMode: id })])) as Record<
        SafetyMode,
        string | null
      >,
      style: Object.fromEntries(
        STYLES.map((st) => [st.id, text({ drivingStyle: st.id })]),
      ) as Record<DrivingStyle, string | null>,
    };
  }, [open, geo, origin, destination, vehicles, selectedVehicleId, conditions]);
}

const MODES: { id: PlanningMode; label: string; hint: string }[] = [
  { id: "fastest", label: "Más rápida", hint: "Menos tiempo total, cargadores de alta potencia." },
  {
    id: "efficient",
    label: "Más eficiente",
    hint: "Ruta y cargadores que menos energía gastan (tu forma de conducir la fija el estilo).",
  },
  { id: "fewer_stops", label: "Menos paradas", hint: "Cargas más largas, menos detenciones." },
  {
    id: "safer",
    label: "Más segura",
    hint: "Carga con holgura (≥ 70 %) y prefiere la ruta con más batería mínima.",
  },
  {
    id: "custom",
    label: "Personalizada",
    hint: "Sin ajustes propios: usa tu margen y estilo tal cual.",
  },
];

export function ConditionsDialog() {
  const open = usePlanner((s) => s.settingsOpen);
  const setOpen = usePlanner((s) => s.setSettingsOpen);
  const c = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const floor = safetyPct(c);
  const previews = usePreviews(open);
  const warnings = conditionWarnings(c);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Condiciones del viaje</DialogTitle>
          <DialogDescription>
            Estrategia, margen de seguridad y estilo de conducción. La llegada mínima está en la
            gestión de batería; pasajeros, equipaje y A/C, en cada ruta.
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

        <section className="mt-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">
            Carga y margen
          </h3>
          <div className="grid gap-2">
            <Label>Margen de seguridad · {floor}%</Label>
            <div className="flex flex-wrap gap-1.5">
              {MARGINS.map(([id, label]) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  className="h-11"
                  variant={c.safetyMode === id ? "default" : "secondary"}
                  onClick={() => patch({ safetyMode: id })}
                >
                  {label}
                </Button>
              ))}
            </div>
            {previews ? (
              <ul className="grid gap-0.5 text-xs text-muted">
                {MARGINS.filter(([id]) => id !== "custom" && id !== c.safetyMode).map(
                  ([id, label]) => (
                    <li key={id}>
                      {label}: <span className="text-accent">{previews.margin[id]}</span>
                    </li>
                  ),
                )}
              </ul>
            ) : null}
            <p className="text-xs text-subtle">
              Batería mínima para llegar a cada cargador y al destino. No cambia el consumo: cambia
              cuántas paradas y cuánto cargar.
            </p>
            {c.safetyMode === "custom" ? (
              <Row label="Personalizado" value={`${c.customSafetyPct}%`}>
                <Slider
                  min={5}
                  max={35}
                  value={[c.customSafetyPct]}
                  onValueChange={([v]) => patch({ customSafetyPct: v ?? 15 })}
                />
              </Row>
            ) : null}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-bg-elevated px-3 py-2.5">
            <span className="text-sm">Permitir bajar del margen</span>
            <Switch
              checked={c.allowBelowSafety}
              onCheckedChange={(v) => patch({ allowBelowSafety: v })}
            />
          </label>
        </section>

        <section className="mt-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Conducción</h3>
          <div className="grid gap-2">
            <Label>Estilo</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {STYLES.map((st) => (
                <div key={st.id} className="grid gap-1">
                  <Button
                    size="sm"
                    className="h-11"
                    variant={c.drivingStyle === st.id ? "default" : "secondary"}
                    onClick={() => patch({ drivingStyle: st.id })}
                  >
                    {st.label}
                  </Button>
                  <span className="text-center text-[11px] leading-tight text-muted">
                    {previews && c.drivingStyle !== st.id && previews.style[st.id] ? (
                      <span className="text-accent">{previews.style[st.id]}</span>
                    ) : (
                      st.hint
                    )}
                  </span>
                </div>
              ))}
            </div>
            {c.avgSpeedKmh != null ? (
              <p className="text-xs text-subtle">
                Con velocidad media fija, el estilo solo cambia el consumo, no el tiempo.
              </p>
            ) : null}
          </div>
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
