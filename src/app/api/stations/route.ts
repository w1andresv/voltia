import { getStationDataset } from "@/infrastructure/stations/service";

export const dynamic = "force-dynamic";

/** Listado público: todo menos `attributes` y `conflicts` (esos van en el detalle). */
export async function GET(request: Request) {
  const dataset = await getStationDataset();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === dataset.version) {
    return new Response(null, { status: 304, headers: { etag: dataset.version } });
  }

  const stations = dataset.stations.map(({ attributes: _attributes, conflicts: _conflicts, ...rest }) => rest);
  return Response.json(
    {
      version: dataset.version,
      generatedAt: dataset.generatedAt,
      stations,
      sources: dataset.sources,
      stats: dataset.stats,
    },
    { headers: { etag: dataset.version } },
  );
}
