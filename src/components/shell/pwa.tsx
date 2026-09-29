"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { CloudOff, X } from "lucide-react";
import type { GeoBundle } from "@/domain/types";
import { formatUpdatedAt } from "@/lib/format";
import { loadLastTrip, saveLastTrip, type LastTrip } from "@/lib/last-trip";
import { engineOfPath } from "@/lib/planner-routes";
import { usePlanner } from "@/lib/store";
import { Button } from "@/components/ui/button";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Si el navegador dice que no hay red. En el servidor y al hidratar, que sí hay. */
function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

/** Registra public/sw.js. Solo en producción: en desarrollo guardaría código viejo. */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err: unknown) => console.warn("[pwa] no se pudo registrar el service worker", err));
  }, []);
}

/**
 * Guarda el último plan calculado para abrirlo sin conexión. Espera a que el
 * plan deje de cambiar (condiciones, ruta elegida) para no serializar ~300 KB
 * en cada paso de un control. `plannedAt` es cuándo se consultaron las rutas:
 * cambiar condiciones no lo mueve.
 */
function usePersistLastTrip(plannedAt: React.RefObject<{ geo: GeoBundle; at: string } | null>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = usePlanner.subscribe((s, prev) => {
      if (
        s.geo === prev.geo &&
        s.selectedPlanId === prev.selectedPlanId &&
        s.conditions === prev.conditions &&
        s.selectedVehicleId === prev.selectedVehicleId
      ) {
        return;
      }
      if (!s.geo || !s.origin || !s.destination || !s.plans.length) return;
      if (plannedAt.current?.geo !== s.geo) {
        plannedAt.current = { geo: s.geo, at: new Date().toISOString() };
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = usePlanner.getState();
        if (!t.geo || !t.origin || !t.destination) return;
        saveLastTrip({
          savedAt:
            plannedAt.current?.geo === t.geo ? plannedAt.current.at : new Date().toISOString(),
          origin: t.origin,
          destination: t.destination,
          waypoints: t.waypoints,
          vehicle: t.selectedVehicle(),
          conditions: t.conditions,
          geo: t.geo,
          selectedPlanId: t.selectedPlanId,
        });
      }, 1000);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [plannedAt]);
}

function OfflineBanner({ onRestore }: { onRestore: (trip: LastTrip) => void }) {
  const offline = useOffline();
  // Cerrado vale hasta que vuelva la red: si se va otra vez, el aviso reaparece.
  const [closed, setClosed] = useState(false);
  const [wasOffline, setWasOffline] = useState(offline);
  if (wasOffline !== offline) {
    setWasOffline(offline);
    if (!offline) setClosed(false);
  }
  const pathname = usePathname();
  const hasPlan = usePlanner((s) => s.plans.length > 0);
  const inPlanner = engineOfPath(pathname) != null;
  // Solo se lee (~300 KB) cuando hace falta ofrecerlo.
  const lastTrip = useMemo(
    () => (offline && inPlanner && !hasPlan ? loadLastTrip() : null),
    [offline, inPlanner, hasPlan],
  );
  // La página /offline ya lo dice.
  if (!offline || closed || pathname === "/offline") return null;

  return (
    <div
      role="status"
      className="pointer-events-auto fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-surface px-3 py-2.5 text-sm shadow-float"
    >
      <CloudOff className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">Sin conexión</div>
        {lastTrip ? (
          <>
            <p className="text-xs text-muted">
              Tu último plan quedó guardado en este dispositivo: {lastTrip.origin.label} →{" "}
              {lastTrip.destination.label} (calculado el {formatUpdatedAt(lastTrip.savedAt)})
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2 h-11"
              onClick={() => onRestore(lastTrip)}
            >
              Ver último plan
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted">
            {hasPlan
              ? "Puedes seguir viendo el plan abierto. Para calcular uno nuevo hace falta internet."
              : "Para calcular un plan hace falta internet."}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Cerrar aviso"
        className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
        onClick={() => setClosed(true)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * Lo que hace de la app una PWA en el navegador: el service worker, el último
 * plan guardado para usar sin conexión y el aviso cuando no hay red.
 */
export function PwaSupport() {
  const plannedAt = useRef<{ geo: GeoBundle; at: string } | null>(null);
  const restoreTrip = usePlanner((s) => s.restoreTrip);
  useServiceWorker();
  usePersistLastTrip(plannedAt);
  return (
    <OfflineBanner
      onRestore={(trip) => {
        plannedAt.current = { geo: trip.geo, at: trip.savedAt };
        restoreTrip(trip);
      }}
    />
  );
}
