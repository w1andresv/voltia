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
import { LoaderCircle, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { SignInForm, sendMagicLink } from "@/components/auth/sign-in-form";
import { useUserContext } from "@/components/user/user-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActor } from "@/infrastructure/auth/use-actor";

/** Cada cuánto se revisa si el enlace ya se abrió (en otra pestaña del mismo navegador). */
const POLL_MS = 3000;
/** Supabase limita el reenvío del enlace al mismo correo (60 s por defecto). */
const RESEND_COOLDOWN_S = 60;

export interface AuthDialogOptions {
  title?: string;
  description?: ReactNode;
  /** Se cerró sin iniciar sesión (Cancelar, X, Escape o clic fuera). */
  onCancel?: () => void;
  /** Hay sesión: el diálogo se cierra solo. */
  onSignedIn?: () => void;
}

interface AuthDialogValue {
  /** Abre el inicio de sesión en un modal, sin salir de la pantalla. No hace nada si ya hay sesión. */
  openSignIn: (options?: AuthDialogOptions) => void;
}

const Ctx = createContext<AuthDialogValue | null>(null);

type Stage = { kind: "form"; email: string } | { kind: "waiting"; email: string };

/**
 * Inicio de sesión global (header, menú, "Iniciar sesión y guardar"). El enlace
 * mágico se abre en otra pestaña; esta se queda esperando en el modal y se
 * entera de la sesión nueva sin recargar (useUserContext().syncSession).
 */
export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const actor = useActor();
  const { syncSession } = useUserContext();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "form", email: "" });
  const [options, setOptions] = useState<AuthDialogOptions>({});
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const openSignIn = useCallback(
    (next: AuthDialogOptions = {}) => {
      if (actor.role !== "guest") return;
      setOptions(next);
      setStage((s) => ({ kind: "form", email: s.email }));
      setOpen(true);
    },
    [actor.role],
  );

  // Hay sesión mientras el modal está abierto: se cierra y se avisa.
  useEffect(() => {
    if (!open || actor.role === "guest") return;
    setOpen(false);
    setStage({ kind: "form", email: "" });
    toast.success(actor.email ? `Sesión iniciada como ${actor.email}.` : "Sesión iniciada.");
    optionsRef.current.onSignedIn?.();
  }, [open, actor.role, actor.email]);

  // Esperando el enlace: revisa la sesión cada pocos segundos.
  useEffect(() => {
    if (!open || stage.kind !== "waiting") return;
    const id = window.setInterval(() => void syncSession(), POLL_MS);
    return () => window.clearInterval(id);
  }, [open, stage.kind, syncSession]);

  function dismiss() {
    setOpen(false);
    optionsRef.current.onCancel?.();
  }

  const value = useMemo<AuthDialogValue>(() => ({ openSignIn }), [openSignIn]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : dismiss())}>
        <DialogContent className="w-[min(100%-1.5rem,440px)]">
          <DialogHeader>
            <DialogTitle>{options.title ?? "Iniciar sesión"}</DialogTitle>
            <DialogDescription>
              {options.description ??
                "Te enviamos un enlace a tu correo; no necesitas contraseña. Tus rutas y vehículos quedan en tu cuenta."}
            </DialogDescription>
          </DialogHeader>

          {stage.kind === "form" ? (
            <div className="grid gap-3">
              <SignInForm
                autoFocus
                initialEmail={stage.email}
                onSent={(email) => setStage({ kind: "waiting", email })}
              />
              <Button variant="ghost" className="h-11 w-full" onClick={dismiss}>
                Cancelar
              </Button>
            </div>
          ) : (
            <WaitingForLink
              email={stage.email}
              onChangeEmail={() => setStage({ kind: "form", email: stage.email })}
              onCancel={dismiss}
            />
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

function WaitingForLink({
  email,
  onChangeEmail,
  onCancel,
}: {
  email: string;
  onChangeEmail: () => void;
  onCancel: () => void;
}) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await sendMagicLink(email);
      setCooldown(RESEND_COOLDOWN_S);
      toast.success("Te reenviamos el enlace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reenviar el enlace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4" aria-live="polite">
      <div className="flex gap-3 rounded-lg bg-bg-elevated p-3">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-accent" />
        <div className="space-y-1 text-sm">
          <p>
            Te enviamos un enlace a <strong className="break-all text-fg">{email}</strong>.
          </p>
          <p className="text-muted">
            Ábrelo <strong className="text-fg">en este mismo navegador</strong>. Esta ventana se
            actualiza sola cuando confirmes; no cierres esta pestaña.
          </p>
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <LoaderCircle className="size-4 animate-spin" />
        Esperando confirmación…
      </p>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          className="h-11"
          disabled={busy || cooldown > 0}
          onClick={() => void resend()}
        >
          {cooldown > 0 ? `Reenviar en ${cooldown} s` : busy ? "Reenviando…" : "Reenviar enlace"}
        </Button>
        <Button variant="ghost" className="h-11" onClick={onChangeEmail}>
          Usar otro correo
        </Button>
      </div>
      <Button variant="ghost" className="h-11 w-full" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

export function useAuthDialog(): AuthDialogValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuthDialog debe usarse dentro de <AuthDialogProvider>.");
  return value;
}
