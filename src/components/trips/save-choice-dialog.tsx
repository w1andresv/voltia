"use client";

import { Check, HardDrive, Minus, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_GUEST_TRIPS } from "@/infrastructure/user-data/guest-storage";
import { SAVE_CHOICE_DAYS } from "@/infrastructure/user-data/save-preference";

const COMPARISON: { label: string; account: boolean; guest: boolean }[] = [
  { label: "Guardar ruta", account: true, guest: true },
  { label: "Asociada a una cuenta", account: true, guest: false },
  { label: "Disponible en otros dispositivos", account: true, guest: false },
  { label: "Requiere cuenta", account: true, guest: false },
  { label: "Persistencia en este navegador", account: true, guest: true },
];

/**
 * Antes de guardar la primera ruta sin sesión: explica, en términos neutros,
 * qué pasa con la ruta si inicia sesión o si sigue como invitado. Ninguna de
 * las dos opciones se presenta como obligatoria ni recomendada.
 */
export function SaveChoiceDialog({
  open,
  onOpenChange,
  onSignIn,
  onGuest,
  guestLimitReached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: () => void;
  onGuest: () => void;
  guestLimitReached: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100%-1.5rem,680px)]">
        <DialogHeader>
          <DialogTitle>¿Cómo quieres guardar esta ruta?</DialogTitle>
          <DialogDescription>
            Puedes usar Voltia con o sin cuenta. Esto es lo que pasa con tu ruta en cada caso.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={<UserRound className="size-5" />}
            title="Iniciar sesión"
            points={[
              "La ruta queda asociada a tu cuenta.",
              "Puedes abrirla después desde otros dispositivos o navegadores.",
              "Tus rutas y vehículos se mantienen en tu cuenta.",
              "Los recuperas al volver a entrar, aunque cierres sesión o cambies de dispositivo.",
              "Si ya guardaste rutas o vehículos en este navegador, se pasan a tu cuenta.",
            ]}
            footnote="Te enviamos un enlace al correo; no necesitas contraseña."
            action={
              <Button variant="secondary" className="h-11 w-full" onClick={onSignIn}>
                Iniciar sesión y guardar
              </Button>
            }
          />
          <ChoiceCard
            icon={<HardDrive className="size-5" />}
            title="Continuar sin iniciar sesión"
            points={[
              "La ruta se guarda solo en este navegador y dispositivo.",
              "Queda almacenada localmente, en el espacio de este navegador.",
              "No estará disponible automáticamente en otros dispositivos o navegadores.",
              "Si borras los datos del navegador o cambias de dispositivo, podrías perderla.",
              "No necesitas crear una cuenta para seguir usando la aplicación.",
            ]}
            footnote={
              guestLimitReached
                ? `Ya tienes ${MAX_GUEST_TRIPS} rutas guardadas en este navegador, el máximo sin cuenta.`
                : `Recordaremos esta elección en este navegador durante ${SAVE_CHOICE_DAYS} días.`
            }
            footnoteTone={guestLimitReached ? "warn" : "muted"}
            action={
              <Button
                variant="secondary"
                className="h-11 w-full"
                disabled={guestLimitReached}
                onClick={onGuest}
              >
                Guardar sin iniciar sesión
              </Button>
            }
          />
        </div>

        <ComparisonTable />

        <Button variant="ghost" className="mt-3 h-11 w-full" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceCard({
  icon,
  title,
  points,
  footnote,
  footnoteTone = "muted",
  action,
}: {
  icon: ReactNode;
  title: string;
  points: string[];
  footnote: string;
  footnoteTone?: "muted" | "warn";
  action: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-8 place-items-center rounded-md bg-surface-2 text-fg">
          {icon}
        </span>
        {title}
      </h3>
      <ul className="grid gap-1.5 text-sm text-muted">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-subtle" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <p className={footnoteTone === "warn" ? "text-xs text-warn" : "text-xs text-subtle"}>
        {footnote}
      </p>
      <div className="mt-auto">{action}</div>
    </section>
  );
}

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return yes ? (
    <Check className="mx-auto size-4 text-fg" aria-label={`${label}: sí`} />
  ) : (
    <Minus className="mx-auto size-4 text-subtle" aria-label={`${label}: no`} />
  );
}

function ComparisonTable() {
  return (
    <table className="mt-4 w-full text-left text-xs">
      <caption className="sr-only">
        Comparación entre iniciar sesión y continuar como invitado
      </caption>
      <thead>
        <tr className="border-b border-border text-subtle">
          <th scope="col" className="py-2 pr-2 font-medium" />
          <th scope="col" className="w-24 py-2 text-center font-medium">
            Iniciar sesión
          </th>
          <th scope="col" className="w-24 py-2 text-center font-medium">
            Como invitado
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPARISON.map((row) => (
          <tr key={row.label} className="border-b border-border/50 last:border-0">
            <th scope="row" className="py-2 pr-2 font-normal text-muted">
              {row.label}
            </th>
            <td className="py-2">
              <Mark yes={row.account} label={`${row.label}, iniciar sesión`} />
            </td>
            <td className="py-2">
              <Mark yes={row.guest} label={`${row.label}, como invitado`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
