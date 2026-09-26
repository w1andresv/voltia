import { getStationDataset } from "@/infrastructure/stations/service";

export const dynamic = "force-dynamic";

/** Detalle completo: incluye `attributes` crudos por fuente y `conflicts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dataset = await getStationDataset();
  const station = dataset.stations.find((s) => s.id === id);
  if (!station) return Response.json({ error: "No encontrada" }, { status: 404 });
  return Response.json(station);
}
