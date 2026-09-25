"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mergeVehicles } from "@/domain/user/catalog-rules";
import type { UserDataRepository } from "@/domain/user/ports";
import type { NewTrip, SavedTrip, UserContext } from "@/domain/user/types";
import type { Vehicle } from "@/domain/types";
import { VEHICLE_CATALOG, catalogById } from "@/domain/vehicles";
import { useActorState } from "@/infrastructure/auth/use-actor";
import {
  GuestLimitError,
  createGuestStorage,
  newClientId,
  type GuestStorage,
} from "@/infrastructure/user-data/guest-storage";
import { createLocalRepository } from "@/infrastructure/user-data/local-repository";
import { createRemoteRepository } from "@/infrastructure/user-data/remote-repository";
import {
  AUTH_PING_KEY,
  claimPendingSave,
  clearGuestSaveChoice,
  markPendingSaveDone,
  pingAuthChange,
  restorePendingSave,
} from "@/infrastructure/user-data/save-preference";
import { getBrowserSupabase } from "@/infrastructure/supabase/browser";
import { usePlanner } from "@/lib/store";
import { importGuestDataFn } from "@/server/actions/import-guest-data";
import { listCatalogVehiclesFn } from "@/server/actions/catalog";

const MAX_AUTO_ATTEMPTS = 3;

/** Evento de ventana: un guardado pendiente de iniciar sesión ya quedó en la cuenta (detail = clientId). */
export const PENDING_SAVE_DONE_EVENT = "voltia:pending-save-done";

interface UserContextValue {
  context: UserContext | null;
  /** false mientras se resuelve la sesión y se lee el navegador (evita hidratar con datos a medias). */
  ready: boolean;
  repository: UserDataRepository;
  guest: GuestStorage;
  /** Reintenta ahora la migración del invitado (botón "Reintentar"). */
  retryMigration: () => void;
  /** Borra `voltia-guest` (menú "Borrar mis datos de este navegador" o "Descartar"). */
  discardGuestData: () => void;
  /**
   * Compara la sesión del navegador con la que muestra la app y, si difieren,
   * la vuelve a pedir. Sirve para enterarse de un inicio de sesión hecho en otra
   * pestaña (la del enlace mágico): la cookie cambia, pero esta pestaña no recibe evento.
   */
  syncSession: () => Promise<void>;
}

const Ctx = createContext<UserContextValue | null>(null);

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { actor, isLoading: actorLoading } = useActorState();
  const actorRef = useRef(actor);
  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);
  const queryClient = useQueryClient();
  const [browserReady, setBrowserReady] = useState(false);
  const [guestId, setGuestId] = useState<string>("");
  const warnedRef = useRef(false);

  const guest = useMemo(
    () =>
      createGuestStorage({
        onWriteFailed: (reason) => {
          if (warnedRef.current) return;
          warnedRef.current = true;
          toast.warning(
            reason === "quota"
              ? "No hay espacio en el navegador: tus cambios siguen en esta sesión pero no se guardarán."
              : "Tu navegador no permite guardar datos (¿modo privado?): tus cambios se perderán al cerrar la pestaña.",
          );
        },
      }),
    [],
  );

  useEffect(() => {
    setGuestId(guest.load().guestId);
    setBrowserReady(true);
  }, [guest]);

  const ready = browserReady && !actorLoading;
  const context = useMemo<UserContext | null>(() => {
    if (!ready) return null;
    if (actor.role !== "guest" && actor.id && actor.email) {
      return { kind: "authenticated", userId: actor.id, email: actor.email, role: actor.role };
    }
    return { kind: "guest", guestId };
  }, [ready, actor, guestId]);

  const repository = useMemo(
    () =>
      context?.kind === "authenticated" ? createRemoteRepository() : createLocalRepository(guest),
    [context?.kind, guest],
  );

  const scope = context?.kind === "authenticated" ? context.userId : "guest";

  // Catálogo (público, común a todos): arranca con el de respaldo y se refresca desde la base.
  const catalogQuery = useQuery({
    queryKey: ["catalog"],
    queryFn: () => listCatalogVehiclesFn(),
    // placeholderData (no initialData): el respaldo en código se muestra mientras
    // llega el de la base, pero no cuenta como dato fresco que evite pedirlo.
    placeholderData: VEHICLE_CATALOG,
    staleTime: 600_000,
  });
  const catalog = catalogQuery.data ?? VEHICLE_CATALOG;

  const ownQuery = useQuery({
    queryKey: ["user-data", scope, "vehicles"],
    queryFn: () => repository.listVehicles(),
    enabled: Boolean(context),
  });

  // Espeja catálogo + propios en el store (memoria) cuando la lista es la definitiva.
  const setVehicles = usePlanner((s) => s.setVehicles);
  // Si los propios fallan (red, permisos), el catálogo se muestra igual.
  useEffect(() => {
    if (!context || ownQuery.isPending) return;
    setVehicles(mergeVehicles(catalog, ownQuery.isSuccess ? ownQuery.data : []));
  }, [context, ownQuery.isPending, ownQuery.isSuccess, ownQuery.data, catalog, setVehicles]);

  const invalidateUserData = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["user-data"] }),
    [queryClient],
  );

  // --- Migración invitado → autenticado -------------------------------------
  const migratingRef = useRef(false);
  const runMigration = useCallback(
    async (manual: boolean) => {
      if (context?.kind !== "authenticated" || migratingRef.current) return;
      const data = guest.load();
      if (data.vehicles.length === 0 && data.trips.length === 0) return;
      if (!manual && data.migration && data.migration.attempts >= MAX_AUTO_ATTEMPTS) return;

      migratingRef.current = true;
      try {
        const result = await importGuestDataFn({
          data: {
            vehicles: data.vehicles,
            trips: data.trips.map((t) => ({
              clientId: t.clientId,
              request: t.request,
              summary: t.summary,
            })),
          },
        });

        // El cliente solo borra lo que el servidor confirmó.
        const failedVehicles = new Set(
          result.vehicles.filter((v) => v.status === "failed").map((v) => v.localId),
        );
        const failedTrips = new Set(
          result.trips.filter((t) => t.status === "failed").map((t) => t.clientId),
        );
        const current = guest.load();
        const remaining = {
          ...current,
          vehicles: current.vehicles.filter(
            (v) => failedVehicles.has(v.id) || !result.vehicles.some((r) => r.localId === v.id),
          ),
          trips: current.trips.filter(
            (t) =>
              failedTrips.has(t.clientId) || !result.trips.some((r) => r.clientId === t.clientId),
          ),
        };
        const failedCount = failedVehicles.size + failedTrips.size;
        guest.save({
          ...remaining,
          migration: failedCount
            ? {
                userId: context.userId,
                attempts: (current.migration?.attempts ?? 0) + 1,
                lastAttemptAt: new Date().toISOString(),
                pending: [...failedVehicles, ...failedTrips],
              }
            : undefined,
        });

        // Remapea el vehículo seleccionado si su id cambió.
        const selected = usePlanner.getState().selectedVehicleId;
        const mapped = result.idMap[selected];
        if (mapped) usePlanner.getState().setVehicleId(mapped);

        const importedV = result.vehicles.filter((v) => v.status === "imported").length;
        const importedT = result.trips.filter((t) => t.status === "imported").length;
        await invalidateUserData();

        if (importedV + importedT > 0) {
          const parts = [
            importedV ? `${importedV} vehículo${importedV === 1 ? "" : "s"}` : null,
            importedT ? `${importedT} ruta${importedT === 1 ? "" : "s"}` : null,
          ].filter(Boolean);
          toast.success(`Se importaron ${parts.join(" y ")} a tu cuenta.`);
        }
        if (result.discardedEdits.length > 0) {
          toast.info(
            "Tu cuenta ya tenía una edición de algunos modelos: se conservó la de tu cuenta.",
          );
        }
        if (failedCount > 0) {
          const attempts = (current.migration?.attempts ?? 0) + 1;
          if (attempts >= MAX_AUTO_ATTEMPTS) {
            toast.error("No pudimos importar todos tus datos locales.", {
              duration: Infinity,
              action: { label: "Reintentar", onClick: () => void runMigration(true) },
              cancel: { label: "Descartar", onClick: () => discardRef.current() },
            });
          }
        }
      } catch (error) {
        const data2 = guest.load();
        guest.save({
          ...data2,
          migration: {
            userId: context.userId,
            attempts: (data2.migration?.attempts ?? 0) + 1,
            lastAttemptAt: new Date().toISOString(),
            pending: data2.migration?.pending ?? [],
          },
        });
        console.error("[user-data] migración del invitado fallida", error);
      } finally {
        migratingRef.current = false;
      }
    },
    [context, guest, invalidateUserData],
  );

  const discardGuestData = useCallback(() => {
    guest.clear();
    clearGuestSaveChoice();
    // Se vuelve a crear un invitado limpio (mismo navegador, bolsa vacía).
    setGuestId(guest.load().guestId);
    void invalidateUserData();
    toast.success("Borramos los datos de este navegador.");
  }, [guest, invalidateUserData]);
  const discardRef = useRef(discardGuestData);
  useEffect(() => {
    discardRef.current = discardGuestData;
  }, [discardGuestData]);

  useEffect(() => {
    if (context?.kind === "authenticated") void runMigration(false);
  }, [context, runMigration]);

  // --- "Iniciar sesión y guardar": al haber sesión, la ruta pendiente va a la cuenta.
  const savingPendingRef = useRef(false);
  const savePending = useCallback(async () => {
    if (context?.kind !== "authenticated" || savingPendingRef.current) return;
    const pending = claimPendingSave();
    if (!pending) return;
    savingPendingRef.current = true;
    try {
      await repository.saveTrip({
        clientId: pending.clientId,
        request: pending.request,
        summary: pending.summary,
      });
      markPendingSaveDone(pending.clientId);
      window.dispatchEvent(new CustomEvent(PENDING_SAVE_DONE_EVENT, { detail: pending.clientId }));
      await queryClient.invalidateQueries({ queryKey: ["user-data", context.userId, "trips"] });
      toast.success("Tu ruta quedó guardada en tu cuenta.");
    } catch (error) {
      restorePendingSave(pending);
      console.error("[user-data] no se pudo guardar la ruta pendiente", error);
      toast.error("Iniciaste sesión, pero no pudimos guardar tu ruta.", {
        duration: Infinity,
        action: { label: "Reintentar", onClick: () => void savePendingRef.current() },
      });
    } finally {
      savingPendingRef.current = false;
    }
  }, [context, repository, queryClient]);
  const savePendingRef = useRef(savePending);
  useEffect(() => {
    savePendingRef.current = savePending;
  }, [savePending]);

  useEffect(() => {
    if (context?.kind === "authenticated") void savePending();
  }, [context, savePending]);

  // --- Sesión consistente entre pestañas ------------------------------------
  const syncSession = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    try {
      const { data } = await supabase.auth.getSession();
      const hasSession = Boolean(data.session);
      if (hasSession !== (actorRef.current.role !== "guest")) {
        await queryClient.invalidateQueries({ queryKey: ["actor"] });
      }
    } catch {
      /* sin red o sin cookies: se reintenta en el próximo foco */
    }
  }, [queryClient]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncSession();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_PING_KEY) void syncSession();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncSession]);

  // Cada vez que esta pestaña resuelve o cambia de sesión, avisa a las demás.
  const kindRef = useRef<UserContext["kind"] | null>(null);
  useEffect(() => {
    if (!context || kindRef.current === context.kind) return;
    kindRef.current = context.kind;
    pingAuthChange();
  }, [context]);

  const value = useMemo<UserContextValue>(
    () => ({
      context,
      ready,
      repository,
      guest,
      retryMigration: () => void runMigration(true),
      discardGuestData,
      syncSession,
    }),
    [context, ready, repository, guest, runMigration, discardGuestData, syncSession],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserContext(): UserContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useUserContext debe usarse dentro de <UserDataProvider>.");
  return value;
}

function reportLimit(error: unknown): never {
  if (error instanceof GuestLimitError) toast.error(error.message);
  throw error;
}

/** Vehículos del usuario activo: catálogo + propios, con las acciones de guardar, quitar y restaurar. */
export function useVehicles() {
  const { context, repository } = useUserContext();
  const queryClient = useQueryClient();
  const scope = context?.kind === "authenticated" ? context.userId : "guest";
  const key = ["user-data", scope, "vehicles"] as const;
  const catalog = queryClient.getQueryData<Vehicle[]>(["catalog"]) ?? VEHICLE_CATALOG;
  const vehicles = usePlanner((s) => s.vehicles);
  const setVehicleId = usePlanner((s) => s.setVehicleId);

  const save = useMutation({
    mutationFn: async (v: Vehicle) => {
      try {
        return await repository.saveVehicle(v);
      } catch (e) {
        return reportLimit(e);
      }
    },
    onSuccess: async (v) => {
      await queryClient.invalidateQueries({ queryKey: key });
      setVehicleId(v.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteVehicle(id),
    onSuccess: async (_r, id) => {
      await queryClient.invalidateQueries({ queryKey: key });
      if (usePlanner.getState().selectedVehicleId === id)
        setVehicleId(catalogById(id)?.id ?? vehicles[0]?.id ?? "");
    },
  });

  return {
    vehicles,
    catalog,
    saveVehicle: (v: Vehicle) => save.mutateAsync(v),
    /** Quita un personalizado, o restaura un modelo de catálogo editado (borra su edición). */
    removeVehicle: (id: string) => remove.mutateAsync(id),
    isSaving: save.isPending || remove.isPending,
  };
}

/** Rutas guardadas del usuario activo (invitado: navegador; con sesión: cuenta). */
export function useSavedTrips() {
  const { context, repository } = useUserContext();
  const queryClient = useQueryClient();
  const scope = context?.kind === "authenticated" ? context.userId : "guest";
  const key = ["user-data", scope, "trips"] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => repository.listTrips(),
    enabled: Boolean(context),
  });

  const save = useMutation({
    mutationFn: async (t: Omit<NewTrip, "clientId">): Promise<SavedTrip> => {
      try {
        return await repository.saveTrip({ ...t, clientId: newClientId() });
      } catch (e) {
        return reportLimit(e);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteTrip(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    trips: query.data ?? [],
    isLoading: !context || query.isPending,
    isError: query.isError,
    saveTrip: save.mutateAsync,
    isSaving: save.isPending,
    deleteTrip: remove.mutateAsync,
    canShare: context?.kind === "authenticated",
  };
}
