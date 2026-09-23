"use client";

import { type FormEvent, useState } from "react";
import { createSupabaseAuth } from "@/infrastructure/auth/supabase-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Envía el enlace mágico. Vuelve a la página actual (`next`) tras confirmar el correo.
 * Compartido por el formulario y por "Reenviar enlace" del diálogo de inicio de sesión.
 */
export async function sendMagicLink(email: string): Promise<void> {
  const next = `${window.location.pathname}${window.location.search}`;
  await createSupabaseAuth().signInWithEmail(
    email,
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
  );
}

/**
 * Enlace mágico por correo: único método de inicio de sesión del MVP
 * (Google queda para una versión posterior, ver domain/auth/port.ts).
 * Con `onSent`, quien lo usa muestra su propio estado "revisa tu correo"
 * (el diálogo global de inicio de sesión); sin él, lo muestra el formulario.
 */
export function SignInForm({
  className,
  onSent,
  initialEmail = "",
  autoFocus = false,
}: {
  className?: string;
  onSent?: (email: string) => void;
  initialEmail?: string;
  autoFocus?: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await sendMagicLink(trimmed);
      if (onSent) onSent(trimmed);
      else setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el enlace");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className={className ?? "text-sm text-muted"}>
        Revisa <strong className="text-fg">{email.trim()}</strong>: te enviamos un enlace para
        entrar.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={className ?? "grid gap-2"}>
      <Input
        type="email"
        required
        autoComplete="email"
        autoFocus={autoFocus}
        aria-label="Correo electrónico"
        placeholder="tu@correo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <Button type="submit" className="h-11 w-full" disabled={busy}>
        {busy ? "Enviando…" : "Enviarme un enlace"}
      </Button>
    </form>
  );
}
