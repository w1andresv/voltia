#!/usr/bin/env node
/**
 * Imprime el diagnóstico público de la última consolidación (por fuente:
 * registros, aceptados, rechazados; y cuántas estaciones quedan elegibles),
 * vía GET /api/stations. Opcional: STATIONS_BASE_URL (por defecto localhost:8080).
 */
import "./load-env.mjs";

const baseUrl = (process.env.STATIONS_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

const res = await fetch(`${baseUrl}/api/stations`);
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`[stations:report] HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(
  "[stations:report]",
  JSON.stringify({ version: body.version, generatedAt: body.generatedAt, sources: body.sources, stats: body.stats }, null, 2),
);
