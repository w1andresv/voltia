import { refreshStationDataset } from "@/infrastructure/stations/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Protegido con CRON_SECRET. GET porque el cron de Vercel solo invoca así
 * (agrega `Authorization: Bearer $CRON_SECRET` solo); POST para
 * `npm run stations:refresh` / disparos manuales.
 */
async function handle(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return Response.json({ error: "Falta CRON_SECRET en el servidor" }, { status: 503 });

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return Response.json({ error: "No autorizado" }, { status: 401 });

  const dataset = await refreshStationDataset();
  return Response.json({
    version: dataset.version,
    generatedAt: dataset.generatedAt,
    stats: dataset.stats,
    sources: dataset.sources,
  });
}

export const GET = handle;
export const POST = handle;
