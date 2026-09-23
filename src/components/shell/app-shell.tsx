"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, MapPinned, Menu, PlugZap, Route as RouteIcon, Settings2, X, Zap } from "lucide-react";
import { BatteryDialog } from "@/components/planner/battery-panel";
import { ConditionsDialog } from "@/components/planner/conditions-form";
import { PlugshareSettings } from "@/components/planner/plugshare-settings";
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
  const [plugshareOpen, setPlugshareOpen] = useState(false);
  const setVehicle = usePlanner((s) => s.setVehicleModalOpen);
  const setSettings = usePlanner((s) => s.setSettingsOpen);
  const setToken = usePlanner((s) => s.setMapboxToken);
  const hasMapbox = usePlanner((s) => Boolean(s.mapboxToken));
  const hasPlugshare = usePlanner((s) => Boolean(s.plugshareToken));

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
          <button
            type="button"
            className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              setVehicle(true);
            }}
          >
            <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">
              <Car className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-medium text-fg">Vehículos</span>
              <span className="block text-xs text-muted">Catálogo y ficha técnica</span>
            </span>
          </button>

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

          <button
            type="button"
            className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              setSettings(true);
            }}
          >
            <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">
              <Settings2 className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-medium text-fg">Configuración</span>
              <span className="block text-xs text-muted">Estrategia, margen y conducción</span>
            </span>
          </button>
          <button
            type="button"
            className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              setPlugshareOpen(true);
            }}
          >
            <span className="grid size-11 place-items-center rounded-md bg-accent/15 text-accent">
              <PlugZap className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-medium text-fg">PlugShare</span>
              <span className="block text-xs text-muted">
                {hasPlugshare ? "Red conectada" : "Clave opcional de electrolineras"}
              </span>
            </span>
          </button>
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
        <AccountNote />
      </Drawer>

      {children}
      <VehicleEditor />
      <BatteryDialog />
      <ConditionsDialog />
      <PlugshareSettings open={plugshareOpen} onOpenChange={setPlugshareOpen} />
    </>
  );
}

function AccountNote() {
  const [text, setText] = useState("Cuenta…");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((response) => response.json())
      .then((body: { auth?: boolean; google?: boolean; database?: boolean }) => {
        if (cancelled) return;
        if (!body.auth) setText("Cuenta: sin conexión a Supabase");
        else if (!body.database) setText("Cuenta: Auth listo. Falta la base de datos.");
        else if (!body.google) setText("Cuenta: base conectada. Falta activar Google.");
        else setText("Cuenta: Google disponible");
      })
      .catch(() => {
        if (!cancelled) setText("Cuenta: sin conexión a Supabase");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <p className="px-6 pb-6 text-xs leading-relaxed text-subtle">{text}</p>;
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
