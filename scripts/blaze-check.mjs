#!/usr/bin/env node
/**
 * Prueba la API de Blaze con la key de .env.local (ADR-0008): cuántas
 * estaciones devuelve, qué campos llegan (según los scopes de la key) y el
 * detalle de una estación. No imprime la key.
 * Run with `npm run blaze:check` (opcional: BLAZE_STATION_ID=12).
 */
import "./load-env.mjs";

const base = (
  process.env.BLAZE_API_URL?.trim() || "https://blaze.muvatec.com/electrolineras-api/public/v1"
).replace(/\/+$/, "");
const key = process.env.BLAZE_API_KEY?.trim();
if (!key) {
  console.error("[blaze] falta BLAZE_API_KEY en .env.local");
  process.exit(1);
}

const SCOPE_FIELDS = {
  "stations:read": ["name", "city", "status"],
  "location:read": ["lat", "lon"],
  "operators:read": ["operator"],
  "connectors:read": ["connectors"],
  "chargers:read": ["maxKw", "chargersCount"],
};

async function get(path) {
  const t0 = Date.now();
  const res = await fetch(`${base}${path}`, {
    headers: { "x-api-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} (${ms} ms): ${text.slice(0, 200)}`);
  return { body: JSON.parse(text), ms, limit: res.headers.get("x-ratelimit-limit") };
}

async function main() {
  const list = await get("/stations");
  if (!Array.isArray(list.body)) throw new Error("/stations no devolvió una lista");
  const stations = list.body;
  console.log(`[blaze] /stations: ${stations.length} estaciones en ${list.ms} ms`);
  if (list.limit) console.log(`[blaze] límite por minuto: ${list.limit}`);

  console.log("[blaze] campos por scope (estaciones que los traen):");
  for (const [scope, fields] of Object.entries(SCOPE_FIELDS)) {
    const n = stations.filter((s) => fields.every((f) => s[f] != null)).length;
    console.log(`  ${scope.padEnd(16)} ${String(n).padStart(4)}/${stations.length}  ${n ? "✓" : "✗ (¿falta el scope?)"}`);
  }
  const statuses = {};
  for (const s of stations) statuses[s.status ?? "(sin estado)"] = (statuses[s.status ?? "(sin estado)"] ?? 0) + 1;
  console.log("[blaze] estados:", statuses);
  const labels = new Set(
    stations.flatMap((s) => String(s.connectors ?? "").split(",").map((l) => l.trim()).filter(Boolean)),
  );
  console.log("[blaze] etiquetas de conector:", [...labels].sort().join(" | ") || "(ninguna)");
  const extra = new Set(stations.flatMap((s) => Object.keys(s)));
  for (const f of ["id", "verified", ...Object.values(SCOPE_FIELDS).flat()]) extra.delete(f);
  if (extra.size) console.log("[blaze] campos no documentados:", [...extra].join(", "));

  const id = process.env.BLAZE_STATION_ID?.trim() || stations[0]?.id;
  if (id == null) return;
  const detail = await get(`/stations/${encodeURIComponent(id)}`);
  console.log(`[blaze] /stations/${id} en ${detail.ms} ms:`);
  console.log(JSON.stringify(detail.body, null, 2));
}

main().catch((err) => {
  console.error("[blaze]", err instanceof Error ? err.message : err);
  process.exit(1);
});
