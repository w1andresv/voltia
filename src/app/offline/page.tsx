import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { RetryLink } from "./retry-link";

export const metadata: Metadata = {
  title: "EV-on-way · Sin conexión",
  robots: { index: false, follow: false },
};

/**
 * Respaldo del service worker (public/sw.js): sin red, una página que no
 * quedó guardada redirige aquí con `?desde=` para poder reintentarla. Es
 * estática para que se lea aunque no cargue el JavaScript; los enlaces son
 * navegaciones completas, que el service worker responde con lo guardado.
 */
export default function OfflinePage() {
  return (
    <main className="relative z-20 grid h-dvh place-items-center overflow-y-auto bg-bg px-4 pt-14">
      <div className="max-w-sm space-y-4 text-center">
        <CloudOff className="mx-auto size-10 text-warn" aria-hidden />
        <h1 className="text-lg font-semibold text-fg">Sin conexión</h1>
        <p className="text-sm leading-relaxed text-muted">
          No hay internet y esta página no quedó guardada en tu dispositivo.
        </p>
        <p className="text-sm leading-relaxed text-muted">
          Si ya abriste el planificador antes, sí funciona sin conexión: muestra el último plan que
          calculaste, con sus paradas y gráficas.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href="/planificar"
            className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Abrir el planificador
          </a>
          <RetryLink />
        </div>
      </div>
    </main>
  );
}
