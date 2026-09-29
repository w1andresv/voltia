/*
 * Service worker de la PWA (src/components/shell/service-worker.tsx lo registra
 * solo en producción). Qué guarda y cómo:
 *  - /_next/static/*: tienen hash en el nombre, no cambian → caché primero.
 *  - Páginas (navegación): red primero; si no hay red, la última copia, y si
 *    tampoco, /offline. Así el planificador abre en carretera sin señal.
 *  - GET /api/stations: red primero, con la última respuesta de respaldo
 *    (el mapa muestra las electrolineras sin conexión).
 *  - Íconos, imágenes y fuentes propias: la copia guardada y se actualiza detrás.
 * Nunca se guardan: el resto de /api, /auth, los POST (server actions) ni las
 * peticiones RSC de la navegación interna. Los mosaicos del mapa tampoco:
 * quedan al caché normal del navegador.
 *
 * Al cambiar este archivo, subir VERSION: los cachés viejos se borran al activar.
 */
const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGES_CACHE = `pages-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;
const CACHES = [STATIC_CACHE, PAGES_CACHE, DATA_CACHE];

const OFFLINE_URL = "/offline";
const PRECACHE = ["/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];
/** Estas rutas redirigen al planificador de cada motor: sin red se abre el que haya guardado. */
const PLANNER_FALLBACKS = { "/planificar": ["/v2", "/v1"], "/": ["/v2", "/v1"] };
const MAX_STATIC_ENTRIES = 250;
/** Cada cuánto se vuelve a guardar /offline al navegar con red (un deploy cambia sus JS). */
const OFFLINE_REFRESH_MS = 60 * 60 * 1000;
let offlineSavedAt = 0;

/** Guarda /offline con sus JS y CSS: sin ellos, abrirla sin red termina en la pantalla de error de Next. */
async function saveOfflinePage() {
  const response = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
  if (!response.ok) throw new Error(`${OFFLINE_URL} respondió ${response.status}`);
  const html = await response.clone().text();
  const chunks = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g)].map((m) => m[1]);
  const assets = await caches.open(STATIC_CACHE);
  await assets.addAll([...new Set([...PRECACHE, ...chunks])]);
  const pages = await caches.open(PAGES_CACHE);
  await pages.put(OFFLINE_URL, response);
  offlineSavedAt = Date.now();
}

self.addEventListener("install", (event) => {
  event.waitUntil(saveOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !CACHES.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/**
 * Al cerrar sesión o borrar los datos del navegador, la app pide olvidar las
 * páginas y datos guardados. /offline se conserva: no es del usuario.
 */
async function clearUserCaches() {
  const pages = await caches.open(PAGES_CACHE);
  const keys = await pages.keys();
  await Promise.all(
    keys.filter((k) => new URL(k.url).pathname !== OFFLINE_URL).map((k) => pages.delete(k)),
  );
  await caches.delete(DATA_CACHE);
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-user-caches") event.waitUntil(clearUserCaches());
});

function isCacheable(response) {
  return response.ok && response.type === "basic";
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    void trim(STATIC_CACHE, MAX_STATIC_ENTRIES);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (isCacheable(response)) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await refresh) ?? Response.error();
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    // La app manda If-None-Match: sin red se responde con la copia, ignorando esa cabecera.
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response) && !response.redirected) await cache.put(request, response.clone());
    return response;
  } catch {
    const exact = await cache.match(request);
    if (exact) return exact;
    // Otra página no se sirve con esta URL (React la vería distinta al hidratar): se redirige.
    const url = new URL(request.url);
    const redirect = (path) => Response.redirect(new URL(path, self.location.origin).href, 302);
    for (const path of PLANNER_FALLBACKS[url.pathname] ?? []) {
      if (await cache.match(path, { ignoreSearch: true })) return redirect(path);
    }
    const offline = await cache.match(OFFLINE_URL, { ignoreSearch: true });
    if (!offline) return Response.error();
    if (url.pathname === OFFLINE_URL) return offline;
    return redirect(`${OFFLINE_URL}?desde=${encodeURIComponent(url.pathname + url.search)}`);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname === "/api/stations") {
    event.respondWith(networkFirstData(request));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    if (Date.now() - offlineSavedAt > OFFLINE_REFRESH_MS) {
      offlineSavedAt = Date.now();
      event.waitUntil(saveOfflinePage().catch(() => {}));
    }
    return;
  }
  // Navegación interna de Next (RSC): sin red falla y Next hace una navegación completa.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  if (
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:png|svg|jpe?g|webp|ico|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
