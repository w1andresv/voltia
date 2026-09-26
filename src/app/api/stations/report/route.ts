import { requireAdmin } from "@/infrastructure/auth/server-actor";
import { AuthError } from "@/infrastructure/auth/server-actor";
import { getStationDataset } from "@/infrastructure/stations/service";

export const dynamic = "force-dynamic";

/** Diagnóstico de la última consolidación: por fuente, elegibilidad y conflictos. Solo admin. */
export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const dataset = await getStationDataset();

  const ineligibleReasons: Record<string, number> = {};
  let withConflicts = 0;
  for (const station of dataset.stations) {
    if (!station.planning.eligible) {
      for (const reason of station.planning.reasons) {
        ineligibleReasons[reason] = (ineligibleReasons[reason] ?? 0) + 1;
      }
    }
    if (station.conflicts.length) withConflicts++;
  }

  return Response.json({
    version: dataset.version,
    generatedAt: dataset.generatedAt,
    stats: dataset.stats,
    sources: dataset.sources,
    ineligibleReasons,
    stationsWithConflicts: withConflicts,
  });
}
