#!/usr/bin/env node
/**
 * Diagnóstico de distancia: compara cómo ubica la app el origen/destino con cada
 * geocodificador y qué distancia da Mapbox para cada par de puntos.
 *
 * Uso:  node scripts/diagnose-route.mjs "Piedecuesta" "Vélez"
 * Lee MAPBOX_ACCESS_TOKEN o NEXT_PUBLIC_MAPBOX_TOKEN de .env.local / .env.
 * No imprime el token.
 */
import "./load-env.mjs";

const [from = "Piedecuesta", to = "Vélez"] = process.argv.slice(2);
const token = (process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "").trim();
const UA = { "user-agent": "Voltia/1.0 (diagnóstico)" };

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

const fmt = (p) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

async function photon(q) {
  const u = new URLSearchParams({ q, lang: "default", limit: "6", lat: "5.6", lon: "-74.3", zoom: "6" });
  const d = await getJson(`https://photon.komoot.io/api/?${u}`);
  return (d.features ?? []).map((f) => ({
    src: "photon",
    name: [f.properties.name, f.properties.state, f.properties.country].filter(Boolean).join(", "),
    kind: `${f.properties.osm_key}=${f.properties.osm_value} (${f.properties.osm_type})`,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

async function openMeteo(q) {
  const u = new URLSearchParams({ name: q, count: "4", language: "es" });
  const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${u}`);
  return (d.results ?? []).map((r) => ({
    src: "open-meteo",
    name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    kind: r.feature_code,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

async function mapboxGeo(q) {
  if (!token) return [];
  const u = new URLSearchParams({ q, country: "co", language: "es", limit: "4", types: "place,locality,neighborhood,street,address" });
  u.set("access_token", token);
  const d = await getJson(`https://api.mapbox.com/search/geocode/v6/forward?${u}`);
  return (d.features ?? []).map((f) => ({
    src: "mapbox",
    name: f.properties.full_address || f.properties.name,
    kind: f.properties.feature_type,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  }));
}

const TIER = (cls = "") => {
  const c = cls.replace(/_link$/, "");
  if (["motorway", "trunk", "primary"].includes(c)) return "principal";
  if (c === "secondary") return "secundaria";
  if (c === "tertiary") return "terciaria";
  if (["street", "street_limited", "service", "pedestrian", "path", "residential", "unclassified"].includes(c)) return "local";
  if (c === "track") return "destapada";
  return "sin dato";
};

/** Km por clase vial (Mapbox Streets v8), aproximando cada paso por la clase de su 1.ª intersección. */
function mixOf(route) {
  const km = {};
  for (const leg of route.legs ?? [])
    for (const st of leg.steps ?? []) {
      const t = TIER(st.intersections?.[0]?.mapbox_streets_v8?.class);
      km[t] = (km[t] ?? 0) + st.distance / 1000;
    }
  const total = Object.values(km).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(km)
    .sort((x, y) => y[1] - x[1])
    .map(([t, v]) => `${Math.round((v / total) * 100)}% ${t}`)
    .join(", ");
}

async function directions(a, b, profile) {
  const u = new URLSearchParams({ alternatives: "true", geometries: "geojson", overview: "false", steps: "true" });
  u.set("access_token", token);
  const path = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  const d = await getJson(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${path}?${u}`);
  const snap = (d.waypoints ?? []).map((w) => `${(w.distance / 1000).toFixed(2)} km`).join(" / ");
  const classes = new Set();
  for (const r of d.routes ?? [])
    for (const leg of r.legs ?? [])
      for (const st of leg.steps ?? []) for (const it of st.intersections ?? []) if (it.mapbox_streets_v8?.class) classes.add(it.mapbox_streets_v8.class);
  const lines = (d.routes ?? []).map(
    (r, i) => `ruta ${i + 1}: ${(r.distance / 1000).toFixed(1)} km, ${Math.round(r.duration / 60)} min — vías: ${mixOf(r)}`,
  );
  lines.push(`ajuste a la vía ${snap}; clases que devolvió Mapbox: ${[...classes].join(", ") || "NINGUNA (sin mapbox_streets_v8)"}`);
  return lines;
}

async function geocodeAll(q) {
  console.log(`\n=== "${q}" ===`);
  const out = {};
  for (const [label, fn] of [["mapbox", mapboxGeo], ["photon", photon], ["open-meteo", openMeteo]]) {
    try {
      const list = await fn(q);
      out[label] = list;
      list.slice(0, 4).forEach((p, i) => console.log(`  ${label.padEnd(10)} #${i + 1} ${fmt(p)}  ${p.kind}  ${p.name}`));
      if (!list.length) console.log(`  ${label.padEnd(10)} (sin resultados${label === "mapbox" && !token ? ": no hay token" : ""})`);
    } catch (e) {
      console.log(`  ${label.padEnd(10)} ERROR ${e.message}`);
      out[label] = [];
    }
  }
  return out;
}

const A = await geocodeAll(from);
const B = await geocodeAll(to);

if (!token) {
  console.log("\nSin token de Mapbox: no se pueden comparar distancias.");
  process.exit(0);
}

console.log("\n=== Distancia Mapbox para el PRIMER resultado de cada geocodificador ===");
for (const src of ["mapbox", "photon", "open-meteo"]) {
  const a = A[src]?.[0];
  const b = B[src]?.[0];
  if (!a || !b) continue;
  for (const profile of ["driving-traffic", "driving"]) {
    try {
      const lines = await directions(a, b, profile);
      console.log(`  ${src.padEnd(10)} ${profile}`);
      for (const line of lines) console.log(`      ${line}`);
    } catch (e) {
      console.log(`  ${src.padEnd(10)} ${profile.padEnd(15)} ERROR ${e.message}`);
    }
  }
}
console.log(
  "\nSi 'photon' da más km que 'mapbox'/'open-meteo' y su tipo es boundary=administrative (R),\n" +
    "el punto era el centro geográfico del municipio, no el pueblo.",
);
