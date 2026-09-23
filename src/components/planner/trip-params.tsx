import { ChevronDown, Minus, Plus, RotateCcw, Users } from "lucide-react";
import { extraWeightKg, tripMassKg, type ClimateControl } from "@/lib/domain/types";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const AC: { id: ClimateControl; label: string }[] = [
  { id: "off", label: "Sin A/C" },
  { id: "eco", label: "Eco" },
  { id: "normal", label: "A/C" },
  { id: "max", label: "Máx" },
];

export function TripParams() {
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const c = usePlanner((s) => s.conditions);
  const patch = usePlanner((s) => s.patchConditions);
  const mass = tripMassKg(vehicle, c);
  const extra = extraWeightKg(c);

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
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <RotateCcw className="size-4 shrink-0 text-accent" />
            <Label className="text-sm text-fg">Regeneración</Label>
          </div>
          <Stepper
            value={c.regenPct}
            min={5}
            max={80}
            step={5}
            onChange={(n) => patch({ regenPct: n })}
            label={`${c.regenPct} %`}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Valor utilizado para estimar la energía recuperada durante descensos y frenadas. No toda la
          energía potencial de una bajada vuelve a la batería.
        </p>
      </div>
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
