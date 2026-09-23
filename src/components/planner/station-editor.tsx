import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createStationFn, updateStationFn } from "@/server/actions/stations";
import { useActor } from "@/infrastructure/auth/use-actor";
import { SignInForm } from "@/components/auth/sign-in-form";
import type { Charger, ChargerSocket, ConnectorType, StationAvailability } from "@/domain/types";
import { CONNECTOR_LABEL } from "@/domain/types";
import { compressPhoto } from "@/lib/photos";
import { stationPhotoUrl, uploadStationPhoto } from "@/infrastructure/storage/station-photos";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CONNECTORS: ConnectorType[] = ["ccs2", "type2", "chademo", "nacs", "ccs1", "gb_t"];
const AVAIL: { id: StationAvailability; label: string }[] = [
  { id: "unknown", label: "Sin dato" },
  { id: "available", label: "Disponible" },
  { id: "occupied", label: "Ocupada" },
  { id: "offline", label: "Fuera de servicio" },
];

export function StationEditor({ stations }: { stations: Charger[] }) {
  const seed = usePlanner((s) => s.stationSeed);
  const setSeed = usePlanner((s) => s.setStationSeed);
  const existing = seed?.editId ? (stations.find((c) => c.id === seed.editId) ?? null) : null;
  const open = Boolean(seed);
  const qc = useQueryClient();
  const actor = useActor();

  const source = existing;
  const lat = seed?.lat ?? source?.lat ?? 0;
  const lon = seed?.lon ?? source?.lon ?? 0;

  const create = useMutation({
    mutationFn: createStationFn,
    onSuccess: (row) => {
      toast.success("Electrolinera publicada. Ya aparece en el mapa y en Planificar ruta.");
      usePlanner.getState().injectCharger(row);
      void qc.invalidateQueries({ queryKey: ["stations"] });
      setSeed(null);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar"),
  });
  const update = useMutation({
    mutationFn: updateStationFn,
    onSuccess: (row) => {
      toast.success("Ficha actualizada");
      usePlanner.getState().injectCharger(row);
      void qc.invalidateQueries({ queryKey: ["stations"] });
      setSeed(null);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });

  if (!open) return null;

  if (actor.role === "guest") {
    return (
      <Dialog open onOpenChange={(v) => !v && setSeed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inicia sesión para aportar</DialogTitle>
            <DialogDescription>
              Añadir o editar una electrolinera necesita una cuenta, para poder darle seguimiento al aporte.
            </DialogDescription>
          </DialogHeader>
          <SignInForm />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && setSeed(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{source ? "Editar electrolinera" : "Añadir electrolinera"}</DialogTitle>
          <DialogDescription>
            {source
              ? "Los cambios quedan en la ficha comunitaria y se ven en ambas pantallas."
              : "Queda en la red compartida: se ve en este mapa y en Planificar ruta."}
          </DialogDescription>
        </DialogHeader>
        <StationForm
          key={`${lat.toFixed(5)}-${lon.toFixed(5)}-${source?.id ?? "new"}`}
          initial={source}
          lat={lat}
          lon={lon}
          address={seed?.address ?? source?.address ?? ""}
          busy={create.isPending || update.isPending}
          ownerId={actor.id ?? ""}
          onSubmit={(payload) => {
            if (source) update.mutate({ data: { ...payload, id: source.id } });
            else create.mutate({ data: payload });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function StationForm({
  initial,
  lat,
  lon,
  address,
  busy,
  ownerId,
  onSubmit,
}: {
  initial?: Charger | null;
  lat: number;
  lon: number;
  address: string;
  busy: boolean;
  ownerId: string;
  onSubmit: (d: {
    name: string;
    lat: number;
    lon: number;
    address?: string;
    operator?: string;
    sockets: ChargerSocket[];
    openingHours?: string;
    pricePerKwh?: number | null;
    priceCurrency?: string;
    notes?: string;
    photos?: string[];
    availability?: StationAvailability;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [addr, setAddr] = useState(address);
  const [operator, setOperator] = useState(initial?.operator ?? "");
  const [hours, setHours] = useState(initial?.openingHours ?? "");
  const [price, setPrice] = useState(initial?.pricePerKwh ? String(initial.pricePerKwh.amount) : "");
  const [currency, setCurrency] = useState(initial?.pricePerKwh?.currency ?? "COP");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [availability, setAvailability] = useState<StationAvailability>(initial?.availability ?? "unknown");
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [sockets, setSockets] = useState<ChargerSocket[]>(
    initial?.sockets?.length ? initial.sockets : [{ connector: "ccs2", powerKw: 50, count: 2 }],
  );
  const [latV, setLatV] = useState(String(lat));
  const [lonV, setLonV] = useState(String(lon));

  const [uploading, setUploading] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files?.length || !ownerId) return;
    setUploading(true);
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= 2) break;
      try {
        const blob = await compressPhoto(file);
        next.push(await uploadStationPhoto(blob, ownerId));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Foto no válida");
      }
    }
    setPhotos(next);
    setUploading(false);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const la = Number(latV);
        const lo = Number(lonV);
        if (!name.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) {
          toast.error("Nombre y coordenadas son obligatorios");
          return;
        }
        const amount = price.trim() ? Number(price) : null;
        onSubmit({
          name: name.trim(),
          lat: la,
          lon: lo,
          address: addr.trim() || undefined,
          operator: operator.trim() || undefined,
          sockets,
          openingHours: hours.trim() || undefined,
          pricePerKwh: amount != null && Number.isFinite(amount) ? amount : null,
          priceCurrency: currency,
          notes: notes.trim() || undefined,
          photos,
          availability,
        });
      }}
    >
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Terpel Voltex San Gil" required />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitud">
          <Input value={latV} onChange={(e) => setLatV(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Longitud">
          <Input value={lonV} onChange={(e) => setLonV(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <Field label="Dirección">
        <Input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Vía, ciudad" />
      </Field>
      <Field label="Operador">
        <Input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="Celsia, Terpel, EPM…" />
      </Field>

      <div className="space-y-2">
        <Label>Conectores</Label>
        {sockets.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_5.5rem_4.5rem_auto] gap-1.5">
            <select
              className="h-11 rounded-md border border-border bg-bg-elevated px-2 text-sm"
              value={s.connector}
              onChange={(e) => {
                const next = sockets.slice();
                next[i] = { ...s, connector: e.target.value as ConnectorType };
                setSockets(next);
              }}
            >
              {CONNECTORS.map((c) => (
                <option key={c} value={c}>
                  {CONNECTOR_LABEL[c]}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={1}
              value={s.powerKw}
              onChange={(e) => {
                const next = sockets.slice();
                next[i] = { ...s, powerKw: Number(e.target.value) || 1 };
                setSockets(next);
              }}
              aria-label="Potencia kW"
            />
            <Input
              type="number"
              min={1}
              value={s.count}
              onChange={(e) => {
                const next = sockets.slice();
                next[i] = { ...s, count: Number(e.target.value) || 1 };
                setSockets(next);
              }}
              aria-label="Cantidad"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSockets(sockets.filter((_, j) => j !== i))}
              disabled={sockets.length <= 1}
              aria-label="Quitar conector"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSockets([...sockets, { connector: "type2", powerKw: 22, count: 1 }])}
        >
          <Plus className="size-3.5" />
          Conector
        </Button>
      </div>

      <Field label="Horario">
        <Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="24/7 o Mo-Su 07:00-22:00" />
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <Field label="Tarifa por kWh">
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Opcional" />
        </Field>
        <Field label="Moneda">
          <select
            className="h-11 w-full rounded-md border border-border bg-bg-elevated px-2 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="COP">COP</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
          </select>
        </Field>
      </div>

      <div className="space-y-2">
        <Label>Disponibilidad</Label>
        <div className="flex flex-wrap gap-1.5">
          {AVAIL.map((a) => (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={availability === a.id ? "default" : "secondary"}
              onClick={() => setAvailability(a.id)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      <Field label="Observaciones">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Acceso, restricciones, estado real…" />
      </Field>

      <div className="space-y-2">
        <Label>Fotos (hasta 2)</Label>
        <Input
          type="file"
          accept="image/*"
          multiple
          disabled={uploading}
          onChange={(e) => void onFiles(e.target.files)}
        />
        {uploading ? <p className="text-xs text-muted">Subiendo foto…</p> : null}
        {photos.length ? (
          <div className="flex gap-2">
            {photos.map((src, i) => (
              <button
                key={i}
                type="button"
                className="relative"
                onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                aria-label="Quitar foto"
              >
                <img src={stationPhotoUrl(src)} alt="" className="h-16 w-24 rounded-md object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={busy || uploading}>
        {initial ? "Guardar cambios" : "Publicar en el mapa"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
