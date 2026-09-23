"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, LogIn, MapPinned, Menu, Route as RouteIcon, Trash2, X, Zap } from "lucide-react";
import { useActor } from "@/infrastructure/auth/use-actor";
import { useUserContext } from "@/components/user/user-context";
import { AccountMenu, useSignOut } from "@/components/auth/account-menu";
import { useAuthDialog } from "@/components/auth/auth-dialog";
import { BatteryDialog } from "@/components/planner/battery-panel";
import { ConditionsDialog } from "@/components/planner/conditions-form";
import { MyTripsDialog } from "@/components/trips/my-trips-dialog";
import { VehicleEditor } from "@/components/planner/vehicle-editor";
import { Button } from "@/components/ui/button";
import { usePlanner } from "@/lib/store";
import { cn } from "@/lib/utils";

const LINKS: { to: "/planificar" | "/electrolineras"; label: string; hint: string; icon: ReactNode }[] = [
  {
    to: "/planificar",
    label: "Planificar ruta",
    hint: "Viaje, mapa y energía en un solo scroll",
    icon: <RouteIcon className="size-5" />,
  },
  {
    to: "/electrolineras",
    label: "Electrolineras",
    hint: "Red pública, PlugShare y altas nuevas",
    icon: <MapPinned className="size-5" />,
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const setMyTripsOpen = usePlanner((s) => s.setMyTripsOpen);
  const setToken = usePlanner((s) => s.setMapboxToken);
  const hasMapbox = usePlanner((s) => Boolean(s.mapboxToken));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const title = pathname.startsWith("/electrolineras") ? "Electrolineras" : "Planificar ruta";

  return (
    <>
      <header className="pointer-events-auto fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/90 px-2 backdrop-blur md:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Abrir menú"
          aria-expanded={open}
          aria-controls="voltia-drawer"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
            <Zap className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{title}</div>
            <div className="truncate text-xs text-muted">Voltia</div>
          </div>
        </div>
        <div className="ml-auto shrink-0">
          <AccountMenu />
        </div>
      </header>

      <Drawer open={open} onClose={() => setOpen(false)}>
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-lg bg-accent text-accent-fg">
              <Zap className="size-5" />
            </span>
            <div>
              <div className="font-display text-lg font-semibold">Voltia</div>
              <div className="text-sm text-muted">Viajes en eléctrico</div>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar menú" onClick={() => setOpen(false)}>
            <X className="size-5" />
          </Button>
        </div>

        <nav className="mt-6 grid gap-1 px-3" aria-label="Principal">
          {LINKS.map((item) => {
            const active =
              item.to === "/planificar"
                ? pathname === "/" || pathname.startsWith("/planificar")
                : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                href={item.to}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-xl px-3",
                  active ? "bg-accent/15 text-fg" : "text-fg hover:bg-surface-2",
                )}
              >
                <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">{item.icon}</span>
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted">{item.hint}</span>
                </span>
              </Link>
            );
          })}

          <MyTripsLink onOpen={() => { setOpen(false); setMyTripsOpen(true); }} />

        </nav>

        {hasMapbox ? (
          <button
            type="button"
            className="mt-auto min-h-11 px-6 pb-2 text-left text-sm text-subtle hover:text-muted"
            onClick={() => {
              setOpen(false);
              setToken("");
            }}
          >
            Cambiar token de Mapbox
          </button>
        ) : (
          <div className="mt-auto" />
        )}
        <AccountNote onNavigate={() => setOpen(false)} />
      </Drawer>

      {children}
      <VehicleEditor />
      <BatteryDialog />
      <ConditionsDialog />
      <MyTripsDialog />
    </>
  );
}

function MyTripsLink({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
      onClick={onOpen}
    >
      <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">
        <History className="size-5" />
      </span>
      <span>
        <span className="block text-sm font-medium text-fg">Mis viajes</span>
        <span className="block text-xs text-muted">Rutas guardadas; compartir por link con sesión</span>
      </span>
    </button>
  );
}

function ClearGuestData() {
  const { discardGuestData } = useUserContext();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="mt-3 flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-subtle hover:text-muted"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4 shrink-0" />
        Borrar mis datos de este navegador
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-lg bg-bg-elevated p-3 text-xs text-muted">
      <p>Se borrarán tus vehículos y rutas guardados en este navegador. No se puede deshacer.</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="danger" className="h-11" onClick={() => { discardGuestData(); setConfirming(false); }}>
          Borrar
        </Button>
        <Button size="sm" variant="ghost" className="h-11" onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function AccountNote({ onNavigate }: { onNavigate: () => void }) {
  const actor = useActor();
  const { openSignIn } = useAuthDialog();
  const { signOut, busy } = useSignOut();

  if (actor.role === "guest") {
    return (
      <div className="px-3 pb-6">
        <p className="px-3 text-xs text-muted">
          Opcional: con una cuenta tus rutas y vehículos te siguen a otros dispositivos.
        </p>
        <Button
          variant="outline"
          className="mt-2 h-11 w-full"
          onClick={() => {
            onNavigate();
            openSignIn();
          }}
        >
          <LogIn className="size-4" />
          Iniciar sesión
        </Button>
        <ClearGuestData />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 px-6 pb-6">
      <p className="min-w-0 truncate text-xs text-subtle">
        {actor.email}
        {actor.role === "admin" ? <span className="ml-1 text-accent">· admin</span> : null}
      </p>
      <button
        type="button"
        className="shrink-0 text-xs text-muted hover:text-fg disabled:opacity-50"
        disabled={busy}
        onClick={() => void signOut()}
      >
        Cerrar sesión
      </button>
    </div>
  );
}

function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const startX = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  function onPointerDown(e: React.PointerEvent) {
    startX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startX.current == null) return;
    setDrag(Math.min(0, e.clientX - startX.current));
  }
  function onPointerUp() {
    if (startX.current == null) return;
    if (drag < -56) onClose();
    startX.current = null;
    setDrag(0);
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-40",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Cerrar menú"
        className={cn(
          "absolute inset-0 bg-bg/60 transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        id="voltia-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        className={cn(
          "absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-surface shadow-panel",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        style={open && drag ? { transform: `translateX(${drag}px)` } : undefined}
        onPointerDown={open ? onPointerDown : undefined}
        onPointerMove={open ? onPointerMove : undefined}
        onPointerUp={open ? onPointerUp : undefined}
      >
        {children}
      </aside>
    </div>
  );
}
