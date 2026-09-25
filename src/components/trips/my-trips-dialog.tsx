"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Link2, Route as RouteIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { shareTripFn, type SavedTrip } from "@/server/actions/trips";
import { formatKm, formatMinutes, formatPct } from "@/lib/format";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSavedTrips } from "@/components/user/user-context";

/**
 * "Mis viajes": historial guardado del usuario (src/lib/api/trips.ts).
 * Replanificar rellena el store global con la petición guardada y navega al
 * planificador; compartir genera (o reusa) un share_id y copia el link
 * público /v/[shareId] (recalcula la ruta al vuelo, sin sesión — ver esa
 * ruta); borrar quita la fila. Nada de esto toca el mapa ni la ruta activa
 * hasta que el usuario elige "Replanificar".
 */
export function MyTripsDialog() {
  const open = usePlanner((s) => s.myTripsOpen);
  const setOpen = usePlanner((s) => s.setMyTripsOpen);
  const applySavedRequest = usePlanner((s) => s.applySavedRequest);
  const router = useRouter();
  const { trips, isLoading, deleteTrip, canShare } = useSavedTrips();
  const queryClient = useQueryClient();

  const shareMut = useMutation({
    mutationFn: (id: string) => shareTripFn({ data: { id } }),
    onSuccess: async ({ shareId }) => {
      const url = `${window.location.origin}/v/${shareId}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado", { description: url });
      } catch {
        toast.success("Link generado", { description: url });
      }
      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "No se pudo compartir el viaje.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTrip(id),
    onSuccess: () => {
      toast.success("Viaje borrado.");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar el viaje.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(100%-1.5rem,560px)]">
        <DialogHeader>
          <DialogTitle>Mis viajes</DialogTitle>
          <DialogDescription>
            {canShare
              ? "Viajes que has guardado desde el planificador. Puedes retomarlos o compartirlos por link."
              : "Viajes guardados en este navegador. Inicia sesión para conservarlos en tu cuenta y compartirlos por link."}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : trips.length ? (
          <ul className="space-y-2">
            {trips.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                onReplan={() => {
                  applySavedRequest(trip.request);
                  setOpen(false);
                  router.push("/planificar");
                }}
                canShare={canShare}
                onShare={() => shareMut.mutate(trip.id)}
                onDelete={() => deleteMut.mutate(trip.id)}
                sharing={shareMut.isPending && shareMut.variables === trip.id}
                deleting={deleteMut.isPending && deleteMut.variables === trip.id}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Todavía no has guardado ningún viaje. Usa "Guardar ruta" en los resultados de una ruta.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TripRow({
  trip,
  onReplan,
  onShare,
  onDelete,
  canShare,
  sharing,
  deleting,
}: {
  trip: SavedTrip;
  onReplan: () => void;
  onShare: () => void;
  onDelete: () => void;
  canShare: boolean;
  sharing: boolean;
  deleting: boolean;
}) {
  return (
    <li className="rounded-lg bg-bg-elevated p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">
            {trip.summary.originLabel} → {trip.summary.destinationLabel}
          </div>
          <div className="font-mono text-xs tabular-nums text-muted">
            {formatKm(trip.summary.distanceKm)} · {formatMinutes(trip.summary.totalMinutes)} ·{" "}
            {trip.summary.stops} {trip.summary.stops === 1 ? "parada" : "paradas"} · llega {formatPct(trip.summary.arrivalSoc)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-11" onClick={onReplan}>
          <RouteIcon className="size-4" />
          Replanificar
        </Button>
        {canShare ? (
          <Button size="sm" variant="outline" className="h-11" disabled={sharing} onClick={onShare}>
            <Link2 className="size-4" />
            {trip.shared ? "Copiar link" : "Compartir"}
          </Button>
        ) : null}
        <Button size="sm" variant="danger" className="h-11" disabled={deleting} onClick={onDelete}>
          <Trash2 className="size-4" />
          Borrar
        </Button>
      </div>
    </li>
  );
}
