import {
  ChevronDown,
  Gauge,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  REGEN_LEVEL_LABEL,
  extraWeightKg,
  safetyPct,
  tripMassKg,
  type ClimateControl,
  type RegenLevel,
} from "@/domain/types";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { MARGINS, MARGIN_NAME, STYLES, usePlanPreviews } from "./use-plan-previews";

const AC: { id: ClimateControl; label: string }[] = [
  { id: "off", label: "Sin A/C" },
  { id: "eco", label: "Eco" },
  { id: "normal", label: "A/C" },
  { id: "max", label: "Máx" },
];

const REGEN: { id: RegenLevel; hint: string }[] = [
  { id: "low", hint: "Frenas mucho con el pedal o el carro regenera poco." },
  { id: "medium", hint: "Uso normal: el carro regenera y a veces usas el freno." },
  { id: "high", hint: "Un pedal y anticipando las bajadas: casi no tocas el freno." },
];

export function TripParams() {
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const c = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const openSettings = usePlanner((s) => s.setSettingsOpen);
  const mass = tripMassKg(vehicle, c);
  const extra = extraWeightKg(c);
  const floor = safetyPct(c);
  const previews = usePlanPreviews(["style", "margin"]);

  return (
    <div className="space-y-3">
      <details className="rounded-xl bg-bg-elevated p-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <Users className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">Este viaje</div>
            <div className="text-xs text-muted">
              Conductor + {c.passengers} {c.passengers === 1 ? "pasajero" : "pasajeros"} · {extra} kg extra ·{" "}
              {Math.round(mass)} kg
            </div>
          </div>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </summary>

        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm text-fg">Pasajeros</Label>
            <Stepper
              value={c.passengers}
              min={0}
              max={6}
              onChange={(n) => patch({ passengers: n })}
              label={`${c.passengers}`}
            />
          </div>
          <p className="text-xs text-muted">0 = solo conductor. Cada persona suma 75 kg al peso de viaje.</p>

          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm text-fg">Equipaje</Label>
            <Stepper
              value={c.luggageKg}
              min={0}
              max={200}
              step={5}
              onChange={(n) => patch({ luggageKg: n })}
              label={`${c.luggageKg} kg`}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Aire acondicionado</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {AC.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  className="h-11 px-1 text-xs"
                  variant={c.ac === opt.id ? "default" : "secondary"}
                  onClick={() => patch({ ac: opt.id })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <div className="rounded-xl bg-bg-elevated p-3">
        <div className="flex min-w-0 items-center gap-2">
          <RotateCcw className="size-4 shrink-0 text-accent" />
          <Label className="text-sm text-fg">Regeneración</Label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Nivel de regeneración">
          {REGEN.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              className="h-11 px-1 text-xs"
              variant={c.regenLevel === opt.id ? "default" : "secondary"}
              aria-pressed={c.regenLevel === opt.id}
              onClick={() => patch({ regenLevel: opt.id })}
            >
              {REGEN_LEVEL_LABEL[opt.id]}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {REGEN.find((opt) => opt.id === c.regenLevel)?.hint} En bajada, la pendiente primero paga
          la rodadura y el aire; de lo que sobra se recupera una parte.
        </p>
      </div>

      <div className="rounded-xl bg-bg-elevated p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Gauge className="size-4 shrink-0 text-accent" />
          <Label className="text-sm text-fg">Conducción</Label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Estilo de conducción">
          {STYLES.map((st) => (
            <Button
              key={st.id}
              type="button"
              size="sm"
              className="h-11 px-1 text-xs"
              variant={c.drivingStyle === st.id ? "default" : "secondary"}
              aria-pressed={c.drivingStyle === st.id}
              onClick={() => patch({ drivingStyle: st.id })}
            >
              {st.label}
            </Button>
          ))}
        </div>
        <ul className="mt-2 grid gap-0.5 text-xs leading-relaxed text-muted">
          {STYLES.map((st) =>
            st.id === c.drivingStyle ? (
              <li key={st.id} className="text-fg">
                {st.label}: {st.hint}
              </li>
            ) : (
              <li key={st.id}>
                {st.label}:{" "}
                {previews?.style[st.id] ? (
                  <span className="text-accent">{previews.style[st.id]}</span>
                ) : (
                  st.hint
                )}
              </li>
            ),
          )}
        </ul>
        {c.avgSpeedKmh != null ? (
          <p className="mt-1.5 text-xs text-subtle">
            Con velocidad media fija, el estilo solo cambia el consumo, no el tiempo.
          </p>
        ) : null}
      </div>

      <div className="rounded-xl bg-bg-elevated p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-accent" />
            <Label className="text-sm text-fg">Margen de seguridad</Label>
          </div>
          <span className="font-mono text-sm tabular-nums text-fg">{floor} %</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5" role="group" aria-label="Margen de seguridad">
          {MARGINS.map((m) => (
            <Button
              key={m.id}
              type="button"
              size="sm"
              className="h-11 px-1 text-xs"
              variant={c.safetyMode === m.id ? "default" : "secondary"}
              aria-pressed={c.safetyMode === m.id}
              aria-label={`${MARGIN_NAME[m.id]} ${m.id === "custom" ? "" : m.label}`.trim()}
              onClick={() => patch({ safetyMode: m.id })}
            >
              {m.label}
            </Button>
          ))}
        </div>
        {c.safetyMode === "custom" ? (
          <div className="mt-3 grid gap-2">
            <Slider
              min={5}
              max={35}
              value={[c.customSafetyPct]}
              onValueChange={([v]) => patch({ customSafetyPct: v ?? 15 })}
              aria-label="Margen personalizado"
            />
          </div>
        ) : null}
        {previews ? (
          <ul className="mt-2 grid gap-0.5 text-xs text-muted">
            {MARGINS.filter((m) => m.id !== "custom" && m.id !== c.safetyMode).map((m) =>
              previews.margin[m.id] ? (
                <li key={m.id}>
                  {m.label}: <span className="text-accent">{previews.margin[m.id]}</span>
                </li>
              ) : null,
            )}
          </ul>
        ) : null}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Batería mínima para llegar a cada cargador y al destino. No cambia el consumo: cambia
          cuántas paradas y cuánto cargar.
        </p>
      </div>

      <button
        type="button"
        onClick={() => openSettings(true)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-bg-elevated px-3 py-2 text-left hover:bg-surface-2"
      >
        <Settings2 className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg">Ajustes avanzados</span>
          <span className="block text-xs text-muted">Estrategia, temperatura y velocidad media</span>
        </span>
      </button>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="size-11"
        aria-label="Menos"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus className="size-4" />
      </Button>
      <span className="min-w-14 text-center font-mono text-sm tabular-nums text-fg">{label}</span>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="size-11"
        aria-label="Más"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
