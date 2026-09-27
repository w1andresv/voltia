import { createStationCatalog } from "@/application/container";

export const dynamic = "force-dynamic";

/** El motor elegido en el planificador (?engine=v1|v2): Blaze solo con v2. Sin él, el del servidor. */
function engineParam(request: Request): "v1" | "v2" | null {
  const engine = new URL(request.url).searchParams.get("engine");
  return engine === "v1" || engine === "v2" ? engine : null;
}

/** Listado público: todo menos `attributes` y `conflicts` (esos van en el detalle). */
export async function GET(request: Request) {
  const dataset = await createStationCatalog(engineParam(request)).getDataset();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === dataset.version) {
    return new Response(null, { status: 304, headers: { etag: dataset.version } });
  }

  const stations = dataset.stations.map(
    ({ attributes: _attributes, conflicts: _conflicts, ...rest }) => rest,
  );
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
