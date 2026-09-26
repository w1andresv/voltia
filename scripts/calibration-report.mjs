#!/usr/bin/env node
/**
 * Resumen de calibración (D13): cuánto se equivoca el modelo según lo que los
 * usuarios anotaron con "¿Con cuánto llegaste?". Solo LEE la tabla
 * voltia_trip_observations (migración 0014). Uso: `npm run calibration:report`.
 *
 * Por versión del modelo y vehículo: viajes, error medio de SOC al llegar
 * (predicho − observado; positivo = el plan fue optimista), error absoluto medio
 * y razón media de consumo observado/predicho (> 1: se consume más de lo previsto).
 */
import "./load-env.mjs";
import pg from "pg";

const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("[calibration] Falta DATABASE_URL (o DIRECT_URL) en .env.local.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const { rows } = await pool.query(`
    select
      model_version,
      payload->>'vehicleId' as vehicle,
      count(*)::int as trips,
      avg((comparison->'socErrors'->-1->>'error')::float) as mean_error,
      avg(abs((comparison->'socErrors'->-1->>'error')::float)) as mean_abs_error,
      avg((comparison->>'consumptionRatio')::float) as consumption_ratio
    from public.voltia_trip_observations
    group by 1, 2
    order by 1 desc, 3 desc
  `);
  if (!rows.length) {
    console.log("[calibration] Todavía no hay observaciones.");
  } else {
    const r1 = (x) => (x == null ? "—" : Math.round(x * 10) / 10);
    const r3 = (x) => (x == null ? "—" : Math.round(x * 1000) / 1000);
    console.table(
      rows.map((r) => ({
        modelo: r.model_version,
        vehículo: r.vehicle,
        viajes: r.trips,
        "error medio (pts)": r1(r.mean_error),
        "error abs. medio (pts)": r1(r.mean_abs_error),
        "consumo obs./pred.": r3(r.consumption_ratio),
      })),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[calibration] No se pudo leer: ${message.split(url).join("***")}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
