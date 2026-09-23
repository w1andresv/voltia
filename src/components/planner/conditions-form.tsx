import type { DrivingStyle, PlanningMode, SafetyMode } from "@/lib/domain/types";
import { safetyPct } from "@/lib/domain/types";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const MODES: { id: PlanningMode; label: string; hint: string }[] = [
  { id: "fastest", label: "Más rápida", hint: "Menos tiempo total, cargadores de alta potencia." },
  { id: "efficient", label: "Más eficiente", hint: "Menor consumo energético." },
  { id: "fewer_stops", label: "Menos paradas", hint: "Cargas más largas, menos detenciones." },
  { id: "safer", label: "Más segura", hint: "Mayor margen de batería." },
  { id: "custom", label: "Personalizada", hint: "Usa tus sliders tal cual." },
];

export function ConditionsDialog() {
  const open = usePlanner((s) => s.settingsOpen);
  const setOpen = usePlanner((s) => s.setSettingsOpen);
  const c = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const floor = safetyPct(c);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Condiciones del viaje</DialogTitle>
          <DialogDescription>
            Estrategia, margen de batería y estilo. Pasajeros, equipaje y A/C se definen en cada ruta.
          </DialogDescription>
        </DialogHeader>

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
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Carga y margen</h3>
          <Row label="Llegada deseada" value={`${c.arrivalSoc}%`}>
            <Slider min={5} max={50} value={[c.arrivalSoc]} onValueChange={([v]) => patch({ arrivalSoc: v ?? 20 })} />
          </Row>
          <div className="grid gap-2">
            <Label>Margen de seguridad · {floor}%</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["conservative", "Conservador 20%"],
                  ["normal", "Normal 15%"],
                  ["low", "Bajo 10%"],
                  ["custom", "Personalizado"],
                ] as [SafetyMode, string][]
              ).map(([id, label]) => (
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
            <Switch checked={c.allowBelowSafety} onCheckedChange={(v) => patch({ allowBelowSafety: v })} />
          </label>
        </section>

        <section className="mt-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Conducción</h3>
          <div className="grid gap-2">
            <Label>Estilo</Label>
            <div className="flex gap-1.5">
              {(
                [
                  ["efficient", "Eficiente"],
                  ["normal", "Normal"],
                  ["sport", "Deportiva"],
                ] as [DrivingStyle, string][]
              ).map(([id, label]) => (
                <Button
                  key={id}
                  size="sm"
                  className="h-11 flex-1"
                  variant={c.drivingStyle === id ? "default" : "secondary"}
                  onClick={() => patch({ drivingStyle: id })}
                >
                  {label}
                </Button>
              ))}
            </div>
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

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
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
