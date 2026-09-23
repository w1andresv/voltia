"use client";

import { useMutation } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { saveTripFn } from "@/server/actions/trips";
import { useActor } from "@/infrastructure/auth/use-actor";
import type { RoutePlan } from "@/domain/types";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";

/**
 * Guarda la petición + un resumen del plan actual en "Mis viajes" (fase 4.1)
 * — el plan en sí no se guarda, se puede recalcular desde la petición. Solo
 * para usuarios con sesión; un invitado nunca ve este botón.
 */
export function SaveTripButton({ plan }: { plan: RoutePlan }) {
  const actor = useActor();
  const [savedId, setSavedId] = useState<string | null>(null);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const waypoints = usePlanner((s) => s.waypoints);
  const vehicle = usePlanner((s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!);
  const conditions = usePlanner((s) => s.conditions);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!origin || !destination) throw new Error("Falta origen o destino.");
      return saveTripFn({
        data: {
          request: { origin, destination, waypoints, vehicle, conditions },
          summary: {
            originLabel: origin.label,
            destinationLabel: destination.label,
            distanceKm: plan.distanceKm,
            totalMinutes: plan.totalMinutes,
            stops: plan.stops.length,
            arrivalSoc: plan.arrivalSoc,
            energyKwh: plan.energyKwh,
          },
        },
      });
    },
    onSuccess: (trip) => {
      setSavedId(trip.id);
      toast.success("Viaje guardado en Mis viajes.");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el viaje.");
    },
  });

  if (actor.role === "guest") return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-11"
      disabled={saveMut.isPending || Boolean(savedId)}
      onClick={() => saveMut.mutate()}
    >
      {savedId ? (
        <>
          <BookmarkCheck className="size-4" />
          Guardado
        </>
      ) : (
        <>
          <Bookmark className="size-4" />
          Guardar viaje
        </>
      )}
    </Button>
  );
}
