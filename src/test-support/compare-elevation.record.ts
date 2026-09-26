/**
 * Compara las fuentes de elevación (ELEVATION_SOURCE, ADR-0011) sobre la misma
 * ruta real: puntos, consultas HTTP, tiempo, desnivel y el efecto en el plan.
 * Uso: `npm run elevation:compare`, o con otra ruta:
 *   ORIGIN=7.1193,-73.1227 DESTINATION=4.711,-74.0721 npm run elevation:compare
 *
 * Necesita red hacia api.mapbox.com y api.open-meteo.com y MAPBOX_ACCESS_TOKEN
 * en .env.local. No lee la base (sin electrolineras: el plan es solo energía).
 */
import { expect, it, vi } from "vitest";
import type { Place } from "@/domain/types";
import { PIEDECUESTA_VELEZ } from "./scenarios";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("server-only", () => ({}));

function place(env: string | undefined, fallback: Place): Place {
  if (!env) return fallback;
  const [lat, lon] = env.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Coordenadas inválidas: ${env}`);
  return { label: env, lat: lat!, lon: lon! };
}

it(
  "compara las fuentes de elevación",
  async () => {
    await import("../../scripts/load-env.mjs");
    const { mapboxServerToken } = await import("@/infrastructure/providers/routing.mapbox");
    const token = mapboxServerToken();
    if (!token) throw new Error("Falta MAPBOX_ACCESS_TOKEN en .env.local.");

    const { MapboxRoutingProvider } = await import("@/infrastructure/providers/adapters");
    const { selectRoutes } = await import("@/application/plan-trip/route-selection");
    const { elevationDeps } = await import("@/application/container");
    const { profileRoute } = await import("@/application/plan-trip/elevation-profile");
    const { computePlans } = await import("@/domain/ev/compute-plan");
    const { MODEL_PARAMETERS } = await import("@/domain/ev/core/params");

    const base = PIEDECUESTA_VELEZ.request();
    const origin = place(process.env.ORIGIN, base.origin);
    const destination = place(process.env.DESTINATION, base.destination);
    const { routes } = await selectRoutes(new MapboxRoutingProvider(token), [origin, destination]);
    const route = routes[0];
    expect(route).toBeDefined();

    // Cuenta las consultas HTTP de cada fuente.
    const realFetch = globalThis.fetch;
    let requests = 0;
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
      requests++;
      return realFetch(...args);
    });

    const rows: Record<string, string | number>[] = [];
    const runs = [
      ["open-meteo", "open-meteo"],
      ["open-meteo-adaptive", "open-meteo-adaptive"],
      ["mapbox-terrain", "mapbox-terrain"],
      ["mapbox-terrain (2.ª vez, caché)", "mapbox-terrain"],
    ] as const;
    for (const [label, source] of runs) {
      requests = 0;
      const deps = elevationDeps(source, token);
      const { route: profiled, report } = await profileRoute(
        route!,
        { provider: deps.elevation, sampling: deps.elevationSampling ?? "fixed", fallback: deps.elevationFallback },
        MODEL_PARAMETERS.elevation,
      );
      const [plan] = computePlans(
        { routes: [profiled], chargers: [], weather: null, origin, destination },
        base.vehicle,
        base.conditions,
      ).plans;
      rows.push({
        fuente: label,
        usada: report.source ?? "ninguna",
        puntos: report.points,
        consultas: requests,
        ms: report.ms,
        "subida m": Math.round(profiled.elevation.gainM),
        "bajada m": Math.round(profiled.elevation.lossM),
        "mín m": Math.round(profiled.elevation.minM),
        "máx m": Math.round(profiled.elevation.maxM),
        kWh: Number(plan!.energyKwh.toFixed(1)),
        "SOC llegada": Number(plan!.arrivalSoc.toFixed(1)),
        ...(report.error ? { error: report.error } : {}),
      });
    }
    vi.unstubAllGlobals();
    console.log(
      `\n[elevación] ${origin.label} → ${destination.label}: ${route!.distanceKm.toFixed(1)} km, ${base.vehicle.brand} ${base.vehicle.model}, SOC salida ${base.conditions.initialSoc} %`,
    );
    console.table(rows);
  },
  300_000,
);
