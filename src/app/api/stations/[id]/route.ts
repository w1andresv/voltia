import { createStationCatalog, createStationDetails } from "@/application/container";
import { checkRateLimit, getClientIp, RateLimitError } from "@/infrastructure/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Detalle completo: incluye `attributes` crudos por fuente y `conflicts`. Con
 * Blaze trae además el estado de cada cargador; si el detalle falla, se
 * responde con la estación del listado.
 */

/** Consultas de detalle a Blaze por IP y minuto: protege el cupo por minuto de la key. */
const DETAIL_LIMIT_PER_MINUTE = 30;

/** false si esta IP ya pasó el límite; sin base de datos para contar, se deja pasar. */
async function withinDetailLimit(): Promise<boolean> {
  try {
    await checkRateLimit("station-detail", await getClientIp(), DETAIL_LIMIT_PER_MINUTE, 60);
    return true;
  } catch (error) {
    return !(error instanceof RateLimitError);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const details = createStationDetails(id);
  if (details && (await withinDetailLimit())) {
    try {
      const station = await details.get(id);
      if (station) return Response.json(station);
    } catch (error) {
      console.warn(
        `[stations:detail] ${id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  // El listado donde está: las de Blaze ("blz_…") en el del motor v2.
  const dataset = await createStationCatalog(id.startsWith("blz_") ? "v2" : "v1").getDataset();
  const station = dataset.stations.find((s) => s.id === id);
  if (!station) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json(station);
}
