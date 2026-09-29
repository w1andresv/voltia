/**
 * Ajuste automático de calibración (guía 05 §5.8, paso 3):
 *
 *   npm run calibration:fit
 *   KNOBS=drivetrainEfficiency,baseAuxPowerKw MIN_TRIPS=5 npm run calibration:fit
 *
 * Solo LEE la base (`voltia_trip_observations` con su viaje de `voltia_trips`)
 * con DATABASE_URL de .env.local. Por vehículo y para todos juntos, ajusta los
 * parámetros de KNOBS con `fitParameters` y escribe el informe en
 * docs/arquitectura-ev/mediciones/calibracion-AAAA-MM-DD.md. No cambia
 * `ModelParameters` ni el catálogo: los valores se pasan a mano, como
 * `sourced(x, "calculated", { reference: "calibración AAAA-MM, N viajes" })`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { TripObservationSchema } from "@/domain/ev/contracts/calibration";
import { parsePlanningSnapshot } from "@/domain/ev/contracts/snapshot";
import { PlanRequestSchema, TripSummarySchema } from "@/domain/schemas";
import {
  calibrationCase,
  DEFAULT_KNOBS,
  fitParameters,
  type CalibrationCase,
  type CalibrationKnob,
  type FitResult,
} from "@/application/calibration/fit-parameters";

const KNOWN: CalibrationKnob[] = [
  "drivetrainEfficiency",
  "rollingResistance",
  "dragAreaM2",
  "baseAuxPowerKw",
];

function knobsFromEnv(): readonly CalibrationKnob[] {
  const raw = process.env.KNOBS?.trim();
  if (!raw) return DEFAULT_KNOBS;
  const list = raw.split(",").map((s) => s.trim()) as CalibrationKnob[];
  const bad = list.filter((k) => !KNOWN.includes(k));
  if (bad.length)
    throw new Error(`KNOBS desconocidos: ${bad.join(", ")}. Válidos: ${KNOWN.join(", ")}`);
  return list;
}

function scrub(message: string): string {
  let out = message;
  for (const secret of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const num = (x: number) => (Math.abs(x) < 0.1 ? x.toFixed(4) : x.toFixed(3));

function table(title: string, fit: FitResult): string {
  const rows = fit.knobs
    .map((k) => `| ${k.knob} | ${num(k.prior)} | ${num(k.fitted)} | ×${k.scale.toFixed(3)} |`)
    .join("\n");
  return [
    `### ${title} (${fit.cases} viajes)`,
    "",
    "| Parámetro | Actual | Ajustado | Factor |",
    "|---|---:|---:|---:|",
    rows,
    "",
    `Error de energía (predicho − observado) / observado: medio ${pct(fit.before.meanRelError)} → ${pct(fit.after.meanRelError)}; absoluto medio ${pct(fit.before.meanAbsRelError)} → ${pct(fit.after.meanAbsRelError)}.`,
    "",
  ].join("\n");
}

it("ajusta los parámetros con las observaciones de la base", async () => {
  if (typeof process.loadEnvFile === "function") await import("../../scripts/load-env.mjs");
  const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Falta DATABASE_URL (o DIRECT_URL) en .env.local.");
  if (!process.env.DATABASE_URL?.trim()) process.env.DATABASE_URL = url;
  const knobs = knobsFromEnv();
  const minTrips = Math.max(1, Number(process.env.MIN_TRIPS ?? 3) || 3);

  const { getSql } = await import("@/infrastructure/db");
  let rows: { trip_id: string; observation: unknown; trip: unknown }[];
  try {
    const sql = await getSql();
    rows = await sql.query(
      `select o.trip_id, o.payload as observation, t.payload as trip
         from public.voltia_trip_observations o
         join public.voltia_trips t on t.id = o.trip_id`,
    );
  } catch (e) {
    throw new Error(
      `No se pudo leer la base: ${scrub(e instanceof Error ? e.message : String(e))}`,
    );
  }

  const cases: CalibrationCase[] = [];
  const skipped = new Map<string, number>();
  const skip = (why: string) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  for (const row of rows) {
    const parse = (v: unknown) =>
      (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;
    const obs = TripObservationSchema.safeParse(parse(row.observation));
    const trip = parse(row.trip);
    const request = PlanRequestSchema.safeParse(trip.request);
    const summary = TripSummarySchema.safeParse(trip.summary);
    if (!obs.success || !request.success || !summary.success) {
      skip("datos inválidos");
      continue;
    }
    const snapshot = parsePlanningSnapshot(trip.snapshot);
    const out = calibrationCase(
      {
        id: row.trip_id,
        request: request.data,
        summary: summary.data,
        ...(snapshot ? { snapshot } : {}),
      },
      obs.data,
    );
    if ("skip" in out) skip(out.skip);
    else cases.push(out);
  }

  const byVehicle = new Map<string, CalibrationCase[]>();
  for (const c of cases) byVehicle.set(c.vehicle.id, [...(byVehicle.get(c.vehicle.id) ?? []), c]);

  const date = new Date().toISOString().slice(0, 10);
  const parts = [
    `# Calibración ${date}`,
    "",
    `Observaciones: ${rows.length}. Usables: ${cases.length}. Parámetros: ${knobs.join(", ")}. Mínimo por grupo: ${minTrips} viajes.`,
    "",
    ...(skipped.size
      ? ["Descartadas: " + [...skipped].map(([why, n]) => `${why} (${n})`).join(", ") + ".", ""]
      : []),
    "Energía v2 recalculada sobre la ruta de cada viaje guardado; lo observado es la caída de SOC más lo que cargaba el plan. Son propuestas: se pasan a mano a `ModelParameters` o al catálogo.",
    "",
  ];
  for (const [id, group] of [...byVehicle].sort((a, b) => b[1].length - a[1].length)) {
    if (group.length < minTrips) {
      parts.push(`### ${id}: ${group.length} viajes, menos del mínimo`, "");
      continue;
    }
    parts.push(table(id, fitParameters(group, { knobs })));
  }
  if (cases.length >= minTrips && byVehicle.size > 1) {
    parts.push(table("Todos los vehículos (factor común)", fitParameters(cases, { knobs })));
  }
  const report = parts.join("\n");

  const dir = fileURLToPath(new URL("../../docs/arquitectura-ev/mediciones/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}calibracion-${date}.md`;
  writeFileSync(file, report + "\n");
  console.log(report);
  console.log(`\nInforme: ${file}`);
  expect(rows.length).toBeGreaterThanOrEqual(0);
});
