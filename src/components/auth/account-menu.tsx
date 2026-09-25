"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, History, LogIn, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuthDialog } from "@/components/auth/auth-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActorState } from "@/infrastructure/auth/use-actor";
import { createSupabaseAuth } from "@/infrastructure/auth/supabase-auth";
import { usePlanner } from "@/lib/store";

/** Cierra sesión y refresca el estado del usuario en toda la app al instante. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await createSupabaseAuth().signOut();
      await queryClient.invalidateQueries({ queryKey: ["actor"] });
      toast.success("Cerraste sesión. Tus rutas siguen en tu cuenta.");
    } catch {
      toast.error("No se pudo cerrar sesión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  return { signOut, busy };
}

/**
 * Estado del usuario en el header: "Iniciar sesión" (abre el modal) o el
 * email de la cuenta con un menú (Mis viajes, Cerrar sesión).
 */
export function AccountMenu() {
  const { actor, isLoading } = useActorState();
  const { openSignIn } = useAuthDialog();
  const { signOut, busy } = useSignOut();
  const setMyTripsOpen = usePlanner((s) => s.setMyTripsOpen);
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return <div className="h-9 w-28 animate-pulse rounded-md bg-surface-2" aria-hidden />;
  }

  if (actor.role === "guest") {
    return (
      <Button variant="outline" size="sm" className="h-9" onClick={() => openSignIn()}>
        <LogIn className="size-4" />
        Iniciar sesión
      </Button>
    );
  }

  const email = actor.email ?? "Tu cuenta";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 max-w-[min(15rem,48vw)] gap-1.5 px-2"
          aria-label={`Cuenta: ${email}`}
        >
          <UserRound className="size-4" />
          <span className="truncate text-fg">{email}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="border-b border-border px-2 pb-2 pt-1">
          <p className="text-xs text-subtle">Sesión iniciada como</p>
          <p className="break-all text-sm text-fg">{email}</p>
          {actor.role === "admin" ? <p className="text-xs text-accent">Administrador</p> : null}
        </div>
        <div className="grid gap-0.5 pt-1">
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              setMyTripsOpen(true);
            }}
          >
            <History className="size-4 text-muted" />
            Mis viajes
          </button>
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm text-fg hover:bg-surface-2 disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              await signOut();
              setOpen(false);
            }}
          >
            <LogOut className="size-4 text-muted" />
            {busy ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
