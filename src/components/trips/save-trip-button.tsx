"use client";

import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthDialog } from "@/components/auth/auth-dialog";
import { SaveChoiceDialog } from "@/components/trips/save-choice-dialog";
import {
  PENDING_SAVE_DONE_EVENT,
  useSavedTrips,
  useUserContext,
} from "@/components/user/user-context";
import { decideSaveAction } from "@/domain/user/save-flow";
import type { RoutePlan } from "@/domain/types";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  GuestLimitError,
  MAX_GUEST_TRIPS,
  newClientId,
} from "@/infrastructure/user-data/guest-storage";
import {
  PENDING_SAVE_DONE_KEY,
  clearPendingSave,
  hasGuestSaveChoice,
  isPendingSaveDone,
  rememberGuestSaveChoice,
  writePendingSave,
} from "@/infrastructure/user-data/save-preference";

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "pending"; clientId: string };

/**
 * "Guardar ruta": guarda la petición + un resumen del plan actual en "Mis viajes"
 * (el plan se recalcula desde la petición).
 *  - Con sesión: directo a la cuenta.
 *  - Invitado: la primera vez explica las dos opciones (SaveChoiceDialog).
 *    "Guardar sin iniciar sesión" guarda en el navegador y se recuerda 180 días.
 *    "Iniciar sesión y guardar" deja la ruta pendiente, abre el inicio de sesión
 *    en un modal y, al haber sesión, UserDataProvider la guarda en la cuenta.
 */
export function SaveTripButton({ plan }: { plan: RoutePlan }) {
  const { context, guest } = useUserContext();
  const { saveTrip, isSaving } = useSavedTrips();
  const { openSignIn } = useAuthDialog();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const waypoints = usePlanner((s) => s.waypoints);
  const vehicle = usePlanner(
    (s) => s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? s.vehicles[0]!,
  );
  const conditions = usePlanner((s) => s.conditions);

  // Otra ruta calculada: el botón vuelve a estar disponible.
  useEffect(() => {
    setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
  }, [plan]);

  // El guardado pendiente terminó (en esta pestaña o en la del enlace mágico).
  const pendingId = status.kind === "pending" ? status.clientId : null;
  useEffect(() => {
    if (!pendingId) return;
    const done = () => setStatus({ kind: "saved" });
    if (isPendingSaveDone(pendingId)) done();
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pendingId) done();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PENDING_SAVE_DONE_KEY && e.newValue === pendingId) done();
    };
    window.addEventListener(PENDING_SAVE_DONE_EVENT, onEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PENDING_SAVE_DONE_EVENT, onEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, [pendingId]);

  function buildTrip() {
    if (!origin || !destination) return null;
    return {
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
    };
  }

  async function saveNow(message: string, description?: string) {
    const trip = buildTrip();
    if (!trip) return;
    try {
      await saveTrip(trip);
      setStatus({ kind: "saved" });
      toast.success(message, description ? { description } : undefined);
    } catch (err) {
      // El aviso de límite del invitado ya lo mostró el hook.
      if (!(err instanceof GuestLimitError))
        toast.error(err instanceof Error ? err.message : "No se pudo guardar la ruta.");
    }
  }

  function onClick() {
    if (!context) return;
    if (!buildTrip()) {
      toast.error("Falta origen o destino.");
      return;
    }
    const action = decideSaveAction({
      kind: context.kind,
      rememberedGuestChoice: hasGuestSaveChoice(),
    });
    if (action === "save-account") void saveNow("Ruta guardada en tu cuenta.");
    else if (action === "save-browser") void saveNow("Ruta guardada en este navegador.");
    else {
      setGuestLimitReached(guest.load().trips.length >= MAX_GUEST_TRIPS);
      setChoiceOpen(true);
    }
  }

  function chooseGuest() {
    rememberGuestSaveChoice();
    setChoiceOpen(false);
    void saveNow(
      "Ruta guardada en este navegador.",
      "La encuentras en Mis viajes. Puedes iniciar sesión cuando quieras para llevarla a tu cuenta.",
    );
  }

  function chooseSignIn() {
    const trip = buildTrip();
    if (!trip) return;
    setChoiceOpen(false);
    const clientId = newClientId();
    if (!writePendingSave({ clientId, ...trip })) {
      toast.error("Tu navegador no permite guardar la ruta mientras inicias sesión.", {
        description: "Inicia sesión y luego pulsa de nuevo «Guardar ruta».",
      });
      openSignIn();
      return;
    }
    setStatus({ kind: "pending", clientId });
    openSignIn({
      title: "Inicia sesión para guardar tu ruta",
      description:
        "Te enviamos un enlace a tu correo, sin contraseña. Al confirmar, guardamos la ruta en tu cuenta; no tienes que salir de esta pantalla.",
      onCancel: () => {
        clearPendingSave(clientId);
        setStatus({ kind: "idle" });
      },
    });
  }

  const busy = isSaving || status.kind === "pending";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11"
        disabled={!context || busy || status.kind === "saved"}
        onClick={onClick}
      >
        {status.kind === "saved" ? (
          <>
            <BookmarkCheck className="size-4" />
            Guardada
          </>
        ) : busy ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Guardando…
          </>
        ) : (
          <>
            <Bookmark className="size-4" />
            Guardar ruta
          </>
        )}
      </Button>
      <SaveChoiceDialog
        open={choiceOpen}
        onOpenChange={setChoiceOpen}
        onSignIn={chooseSignIn}
        onGuest={chooseGuest}
        guestLimitReached={guestLimitReached}
      />
    </>
  );
}
