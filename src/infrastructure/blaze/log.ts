import type { BlazeStation } from "./schemas";

/**
 * Logs de lo que se consulta a Blaze: el listado (usado por el motor v2 para
 * calcular las paradas) y cada detalle. En desarrollo, tabla legible; en
 * producción, una línea JSON por consulta. Nunca incluye la key.
 */
const DEV = process.env.NODE_ENV !== "production";

function row(s: BlazeStation) {
  return {
    id: s.id,
    nombre: s.name,
    ciudad: s.city ?? "",
    estado: s.status ?? "",
    conectores: s.connectors ?? "",
    maxKw: s.maxKw ?? "",
    cargadores: s.chargersCount ?? "",
    coords: s.lat != null && s.lon != null ? `${s.lat},${s.lon}` : "(sin coords)",
  };
}

export function logBlazeList(stations: BlazeStation[], ms: number): void {
  const head = `[blaze] listado: ${stations.length} estaciones en ${ms} ms`;
  if (DEV) {
    console.log(head);
    console.table(stations.map(row));
  } else {
    console.log(
      JSON.stringify({ blaze: "list", count: stations.length, ms, stations: stations.map(row) }),
    );
  }
}

export function logBlazeDetail(id: string, station: BlazeStation | null, ms: number): void {
  if (!station) {
    console.log(`[blaze] detalle ${id}: no encontrada (404) en ${ms} ms`);
    return;
  }
  const chargers = (station.chargers ?? []).map((c) => ({
    conector: c.connectorType ?? "",
    kW: c.powerKw ?? "",
    estado: c.status ?? "",
  }));
  if (DEV) {
    console.log(
      `[blaze] detalle ${id} · ${station.name}${station.city ? ` (${station.city})` : ""} · ${station.status ?? "sin estado"} · ${chargers.length} cargador(es) en ${ms} ms`,
    );
    if (chargers.length) console.table(chargers);
  } else {
    console.log(
      JSON.stringify({
        blaze: "detail",
        id,
        name: station.name,
        status: station.status,
        chargers,
        ms,
      }),
    );
  }
}
