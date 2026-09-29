import { clearLastTrip } from "./last-trip";

/**
 * Olvida lo que la PWA guardó para usar sin conexión: el último plan y las
 * páginas y datos que guardó el service worker (public/sw.js). Se llama al
 * cerrar sesión y al borrar los datos de este navegador.
 */
export function forgetOfflineData(): void {
  clearLastTrip();
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-user-caches" });
  } catch {
    // Sin service worker no hay nada más que borrar.
  }
}
