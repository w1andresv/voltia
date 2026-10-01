import { createGeocoder } from "@/application/container";

export const dynamic = "force-dynamic";

/** Más que esto no es un lugar: se corta para no mandarlo a los proveedores. */
const MAX_QUERY = 120;

function coord(value: string | null, limit: number): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * Búsqueda de lugares para los campos de origen y destino (`?q=`, y `lat`/`lon`
 * opcionales para sesgar hacia un punto). Es un GET y no una server action: las
 * server actions van en fila, una a la vez por cliente, y cada letra esperaría a
 * la búsqueda anterior (o a un plan en curso). Así el navegador puede cancelar
 * las búsquedas viejas y guardar las respuestas unos minutos.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < 2) return Response.json([]);
  const lat = coord(params.get("lat"), 90);
  const lon = coord(params.get("lon"), 180);
  try {
    const places = await createGeocoder().search(
      q,
      lat != null && lon != null ? { lat, lon } : undefined,
    );
    return Response.json(places, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    console.error("[places]", error instanceof Error ? error.message : error);
    return Response.json(
      { error: "No se pudo consultar ningún proveedor de búsqueda de lugares." },
      { status: 502 },
    );
  }
}
