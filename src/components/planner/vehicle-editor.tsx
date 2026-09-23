import { useMemo, useState, type ReactNode } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { CONNECTOR_LABEL, type ConnectorType, type Vehicle } from "@/domain/types";
import { mixedCycleKwhPer100, wltpKwhPer100 } from "@/domain/energy";
import { emptyCustomVehicle, vehicleLabel } from "@/domain/vehicles";
import { differsFromCatalog } from "@/domain/user/catalog-rules";
import { useVehicles } from "@/components/user/user-context";
import { formatKwhPer100 } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONNECTORS: ConnectorType[] = ["ccs2", "ccs1", "type2", "chademo", "nacs", "gb_t"];

export function VehicleEditor() {
  const open = usePlanner((s) => s.vehicleModalOpen);
  const setOpen = usePlanner((s) => s.setVehicleModalOpen);
  const { vehicles, catalog, saveVehicle, removeVehicle } = useVehicles();
  const isCatalogId = (id: string) => catalog.some((c) => c.id === id);
  const isVehicleModified = (v: Vehicle) => isCatalogId(v.id) && differsFromCatalog(v, catalog);
  const selectedId = usePlanner((s) => s.selectedVehicleId);
  const setVehicleId = usePlanner((s) => s.setVehicleId);

  const selected = vehicles.find((v) => v.id === selectedId) ?? vehicles[0]!;
  const [draft, setDraft] = useState<Vehicle | null>(null);
  const editing = draft;
  const isNew = Boolean(editing && !vehicles.some((v) => v.id === editing.id));

  const grouped = useMemo(() => {
    const map = new Map<string, Vehicle[]>();
    for (const v of vehicles) {
      const list = map.get(v.brand) ?? [];
      list.push(v);
      map.set(v.brand, list);
    }
    return [...map.entries()];
  }, [vehicles]);

  function closeForm() {
    setDraft(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) closeForm();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? (isNew ? "Nuevo vehículo" : "Editar vehículo") : "Vehículo"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? isNew
                ? "Ficha técnica: batería, consumo, conectores y límites de carga."
                : isCatalogId(editing.id)
                  ? "Los cambios se guardan en tu cuenta (o en este navegador si no has iniciado sesión). Puedes restaurar el modelo de fábrica."
                  : "Actualiza los datos de tu vehículo. Se guardan en tu cuenta (o en este navegador si no has iniciado sesión)."
              : "Elige un modelo, edítalo o registra el tuyo con datos reales."}
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <VehicleForm
            value={editing}
            onChange={setDraft}
            factory={catalog.find((c) => c.id === editing.id)}
            onSave={() => {
              if (!editing.brand.trim() || !editing.model.trim()) return;
              void saveVehicle({
                ...editing,
                brand: editing.brand.trim(),
                model: editing.model.trim(),
                version: editing.version.trim() || "Personalizado",
                batteryKwh: Math.max(1, editing.batteryKwh || 0),
                rangeKm: Math.max(1, editing.rangeKm || 0),
                consumptionKwhPer100km:
                  editing.consumptionManual && editing.consumptionKwhPer100km && editing.consumptionKwhPer100km > 0
                    ? editing.consumptionKwhPer100km
                    : null,
                consumptionManual: Boolean(
                  editing.consumptionManual && editing.consumptionKwhPer100km && editing.consumptionKwhPer100km > 0,
                ),
              }).catch(() => undefined);
              closeForm();
            }}
            onCancel={closeForm}
          />
        ) : (
          <>
            <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
              {grouped.map(([brand, list]) => (
                <div key={brand}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wider text-subtle">{brand}</div>
                  <div className="space-y-1">
                    {list.map((v) => {
                      const modified = isVehicleModified(v);
                      const custom = Boolean(v.isCustom) && !isCatalogId(v.id);
                      return (
                        <div
                          key={v.id}
                          className={`flex items-stretch rounded-md ${
                            v.id === selectedId ? "bg-accent/15" : "hover:bg-surface-2"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setVehicleId(v.id)}
                            className="min-w-0 flex-1 px-3 py-3 text-left text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium text-fg">{vehicleLabel(v)}</span>
                              {custom ? (
                                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                                  Tuyo
                                </span>
                              ) : modified ? (
                                <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                                  Editado
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {v.version} · {v.batteryKwh} kWh · WLTP {v.rangeKm} km
                            </span>
                          </button>
                          <div className="flex items-center pr-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Editar ${vehicleLabel(v)}`}
                              onClick={() => setDraft({ ...v })}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            {modified ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Restaurar ${vehicleLabel(v)}`}
                                onClick={() => void removeVehicle(v.id).catch(() => undefined)}
                              >
                                <RotateCcw className="size-4" />
                              </Button>
                            ) : null}
                            {custom ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-danger hover:text-danger"
                                aria-label={`Quitar ${vehicleLabel(v)}`}
                                onClick={() => void removeVehicle(v.id).catch(() => undefined)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setDraft({ ...selected })}>
                <Pencil className="size-4" />
                Editar
              </Button>
              <Button variant="outline" onClick={() => setDraft({ ...emptyCustomVehicle() })}>
                Nuevo
              </Button>
              <Button
                variant="secondary"
                className="col-span-2"
                onClick={() =>
                  setDraft({
                    ...selected,
                    isCustom: true,
                    id: `custom-${Date.now()}`,
                    version: selected.version ? `${selected.version} (copia)` : "Copia",
                  })
                }
              >
                Duplicar seleccionado
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VehicleForm({
  value,
  factory,
  onChange,
  onSave,
  onCancel,
}: {
  value: Vehicle;
  factory?: Vehicle;
  onChange: (v: Vehicle) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (p: Partial<Vehicle>) => onChange({ ...value, ...p });
  const num = (k: keyof Vehicle, v: string) => set({ [k]: Number(v) } as Partial<Vehicle>);
  const n = (v: number, digits = 1) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : "");
  const conditions = usePlanner((s) => s.conditions);
  const estimated = mixedCycleKwhPer100(value, conditions, null);
  const wltp = wltpKwhPer100(value);
  const manualOn = Boolean(value.consumptionManual && value.consumptionKwhPer100km && value.consumptionKwhPer100km > 0);

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {factory ? (
        <p className="text-xs text-muted">
          Base de fábrica: {factory.batteryKwh} kWh · WLTP {factory.rangeKm} km · {factory.weightKg} kg ·{" "}
          {factory.motorKw} kW
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Marca">
          <Input value={value.brand} onChange={(e) => set({ brand: e.target.value })} required />
        </Field>
        <Field label="Modelo">
          <Input value={value.model} onChange={(e) => set({ model: e.target.value })} required />
        </Field>
        <Field label="Año">
          <Input type="number" value={n(value.year, 0)} onChange={(e) => num("year", e.target.value)} />
        </Field>
        <Field label="Versión">
          <Input value={value.version} onChange={(e) => set({ version: e.target.value })} />
        </Field>
        <Field label="Batería (kWh)">
          <Input type="number" step="0.1" value={n(value.batteryKwh)} onChange={(e) => num("batteryKwh", e.target.value)} />
        </Field>
        <Field label="Autonomía WLTP (km)">
          <Input type="number" value={n(value.rangeKm, 0)} onChange={(e) => num("rangeKm", e.target.value)} />
        </Field>
        <Field label="Consumo (kWh/100 km)">
          <Input
            type="number"
            step="0.1"
            value={manualOn ? n(value.consumptionKwhPer100km as number) : ""}
            placeholder="Automático"
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) set({ consumptionKwhPer100km: null, consumptionManual: false });
              else set({ consumptionKwhPer100km: Number(raw), consumptionManual: true });
            }}
          />
        </Field>
        <Field label="Peso (kg)">
          <Input type="number" value={n(value.weightKg, 0)} onChange={(e) => num("weightKg", e.target.value)} />
        </Field>
        <p className="col-span-2 text-xs leading-relaxed text-muted">
          {manualOn
            ? "Consumo de ficha: referencia de ciclo mixto. El viaje sigue sumando pendiente, velocidad y clima."
            : `Sin ficha: estimación por peso, potencia, batería y perfil de la ruta. Mixto ahora ${formatKwhPer100(estimated)}${
                wltp ? ` · WLTP implica ${formatKwhPer100(wltp)}` : ""
              }.`}{" "}
          La autonomía WLTP es homologada, no la de cada viaje.
        </p>
        <Field label="Potencia (kW)">
          <Input type="number" value={n(value.motorKw, 0)} onChange={(e) => num("motorKw", e.target.value)} />
        </Field>
        <Field label="Carga AC máx (kW)">
          <Input type="number" step="0.1" value={n(value.acMaxKw)} onChange={(e) => num("acMaxKw", e.target.value)} />
        </Field>
        <Field label="Carga DC máx (kW)">
          <Input type="number" value={n(value.dcMaxKw, 0)} onChange={(e) => num("dcMaxKw", e.target.value)} />
        </Field>
        <Field label="SOC mín. viaje (%)">
          <Input type="number" value={n(value.minSocRecommended, 0)} onChange={(e) => num("minSocRecommended", e.target.value)} />
        </Field>
        <Field label="SOC máx. en ruta (%)">
          <Input type="number" value={n(value.maxSocTravel, 0)} onChange={(e) => num("maxSocTravel", e.target.value)} />
        </Field>
      </div>
      <div>
        <Label className="mb-2 block">Conectores</Label>
        <div className="flex flex-wrap gap-2">
          {CONNECTORS.map((c) => {
            const on = value.connectors.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  set({
                    connectors: on ? value.connectors.filter((x) => x !== c) : [...value.connectors, c],
                  })
                }
                className={`min-h-11 rounded-full px-3 py-2 text-xs ${on ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}
              >
                {CONNECTOR_LABEL[c]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Guardar</Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}
