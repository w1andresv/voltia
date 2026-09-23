"use client";

import { type FormEvent, useState } from "react";
import { createSupabaseAuth } from "@/infrastructure/auth/supabase-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Enlace mágico por correo: único método de inicio de sesión del MVP
 * (Google queda para una versión posterior, ver domain/auth/port.ts).
 * Reutilizado en el menú (app-shell) y en el formulario de aportar estación.
 */
export function SignInForm({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
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
      const next = window.location.pathname;
      await createSupabaseAuth().signInWithEmail(
        trimmed,
        `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      );
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el enlace");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className={className ?? "text-sm text-muted"}>
        Revisa <strong className="text-fg">{email.trim()}</strong>: te enviamos un enlace para entrar.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={className ?? "grid gap-2"}>
      <Input
        type="email"
        required
        autoComplete="email"
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
