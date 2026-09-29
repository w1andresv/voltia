"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * La página que se quiso abrir sin red (`?desde=`, lo pone public/sw.js), solo
 * si es de este mismo sitio; null en el servidor o si no hay una válida.
 */
function wantedPath(): string | null {
  const from = new URLSearchParams(window.location.search).get("desde");
  if (!from) return null;
  try {
    const url = new URL(from, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** "Reintentar": vuelve a pedir la página que no cargó, cuando haya red. */
export function RetryLink() {
  const path = useSyncExternalStore(noSubscription, wantedPath, () => null);
  if (!path) return null;
  return (
    <a
      href={path}
      className="inline-flex h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-fg hover:bg-surface-2"
    >
      Reintentar
    </a>
  );
}
