#!/usr/bin/env node
/**
 * Dispara un refresco del dataset nacional de electrolineras contra un
 * servidor ya corriendo (dev o desplegado), vía POST /api/stations/refresh.
 * Requiere CRON_SECRET (el mismo que valida esa ruta) y, opcionalmente,
 * STATIONS_BASE_URL (por defecto http://localhost:8080, el puerto de `npm run dev`).
 */
import "./load-env.mjs";

const secret = (process.env.CRON_SECRET ?? "").trim();
if (!secret) {
  console.error("[stations:refresh] Falta CRON_SECRET en el entorno.");
  process.exit(1);
}

const baseUrl = (process.env.STATIONS_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

const res = await fetch(`${baseUrl}/api/stations/refresh`, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});

const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`[stations:refresh] HTTP ${res.status}`, body);
  process.exit(1);
}
console.log("[stations:refresh]", JSON.stringify(body, null, 2));
