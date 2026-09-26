import type { 
  ConsolidatedStation, 
  DatasetSourceStatus, 
  NormalizedRecord, 
  StationDataset 
} from "./model";
import { deduplicateRecords } from "./dedupe";
import { mergeRecords } from "./merge";
import { evaluateEligibility } from "./eligibility";

export async function consolidateDataset(
  records: NormalizedRecord[],
  sourcesStatus: DatasetSourceStatus[]
): Promise<StationDataset> {
  const generatedAt = new Date().toISOString();
  
  // 1. Deduplicar y agrupar en clusters
  const clusters = deduplicateRecords(records);
  
  // 2. Fusionar clusters en estaciones consolidadas
  const stations: ConsolidatedStation[] = [];
  let eligibleCount = 0;

  for (const cluster of clusters) {
    if (cluster.length === 0) continue;
    const consolidated = mergeRecords(cluster);
    
    // 3. Evaluar elegibilidad
    const eligibility = evaluateEligibility(consolidated);
    consolidated.planning = eligibility;
    
    if (eligibility.eligible) {
      eligibleCount++;
    }
    
    stations.push(consolidated);
  }

  // 4. Calcular stats
  const stats = {
    raw: sourcesStatus.reduce((acc, s) => acc + s.records, 0),
    valid: records.length,
    stations: stations.length,
    merged: records.length - stations.length,
    eligible: eligibleCount
  };

  // 5. Calcular version hash del contenido (para ETags y caché)
  const contentToHash = JSON.stringify({ stations, sourcesStatus });
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contentToHash));
  const version = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 12);

  return {
    version,
    generatedAt,
    stations,
    sources: sourcesStatus,
    stats
  };
}
