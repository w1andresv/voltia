import { haversineKm } from "../geo";
import { defaultKwForStandard } from "./connectors";
import type { 
  ConsolidatedStation, 
  ExtendedConnectorType,
  NormalizedRecord, 
  SourceId, 
  SourceRef,
  StationConnector
} from "./model";

const COORD_PRIORITY: SourceId[] = ["osm", "community", "plugshare", "ocm", "catalog", "siveeic"];
const IDENTITY_PRIORITY: SourceId[] = ["siveeic", "community", "plugshare", "osm", "ocm", "catalog"];
const MISC_PRIORITY: SourceId[] = ["community", "plugshare", "osm", "ocm", "siveeic", "catalog"];

function sortByPriority(records: NormalizedRecord[], priorityList: SourceId[]): NormalizedRecord[] {
  return [...records].sort((a, b) => {
    const iA = priorityList.indexOf(a.source);
    const iB = priorityList.indexOf(b.source);
    const wA = iA === -1 ? 999 : iA;
    const wB = iB === -1 ? 999 : iB;
    return wA - wB;
  });
}

function pick<T, K extends keyof NormalizedRecord>(
  records: NormalizedRecord[],
  priorityList: SourceId[],
  field: K,
  isValid: (val: NormalizedRecord[K]) => boolean = (val) => val != null && val !== ""
): { value: NormalizedRecord[K]; source: SourceId } | null {
  const sorted = sortByPriority(records, priorityList);
  for (const r of sorted) {
    if (isValid(r[field])) {
      return { value: r[field], source: r.source };
    }
  }
  return null;
}

function mergeConnectors(records: NormalizedRecord[]): StationConnector[] {
  // Agrupar conectores por estándar
  const grouped = new Map<string, StationConnector[]>();
  for (const r of records) {
    for (const c of r.connectors) {
      let list = grouped.get(c.standard);
      if (!list) {
        list = [];
        grouped.set(c.standard, list);
      }
      list.push(c);
    }
  }

  const result: StationConnector[] = [];
  
  for (const [standard, list] of grouped.entries()) {
    // La potencia se toma del registro que la reporte con mayor prioridad, o la mayor reportada;
    // sin ningún reporte, se asume 50/22/150 kW por estándar hasta tener valores reales por estación.
    const withPower = list.filter(c => c.powerKw != null);
    const powerKw = withPower.length
      ? Math.max(...withPower.map(c => c.powerKw!))
      : defaultKwForStandard(standard as ExtendedConnectorType);
    
    // Cantidad: prioridad SIVEEIC > comunidad > OSM...
    // Aquí podemos usar la misma lista de prioridad IDENTITY_PRIORITY
    const sorted = [...list].sort((a, b) => {
      const srcA = a.sources[0]!;
      const srcB = b.sources[0]!;
      const iA = IDENTITY_PRIORITY.indexOf(srcA);
      const iB = IDENTITY_PRIORITY.indexOf(srcB);
      return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB);
    });
    
    const quantity = sorted.find(c => c.quantity != null)?.quantity ?? null;
    const current = sorted.find(c => c.current != null)?.current ?? null;
    const currentOrigin = sorted.find(c => c.currentOrigin != null)?.currentOrigin ?? null;
    
    // Confirmed si al menos una fuente no catálogo lo reporta
    const confirmed = list.some(c => c.sources.some(s => s !== "catalog"));
    
    // Todas las fuentes que reportaron este estándar
    const sources = Array.from(new Set(list.flatMap(c => c.sources)));
    
    result.push({
      standard: standard as any,
      rawLabel: sorted[0]!.rawLabel,
      quantity,
      powerKw,
      current,
      currentOrigin,
      voltageV: sorted.find(c => c.voltageV != null)?.voltageV ?? null,
      amperageA: sorted.find(c => c.amperageA != null)?.amperageA ?? null,
      status: sorted.find(c => c.status !== "unknown")?.status ?? "unknown",
      confirmed,
      sources
    });
  }
  
  return result;
}

/**
 * Consolida un cluster de registros normalizados en una sola estación.
 */
export function mergeRecords(cluster: NormalizedRecord[]): ConsolidatedStation {
  if (cluster.length === 0) throw new Error("Cluster vacío");

  const sourcesRef: SourceRef[] = cluster.map(r => ({
    source: r.source,
    externalId: r.externalId,
    url: r.url,
    fetchedAt: new Date().toISOString(), // Idealmente viene de la fuente
    sourceUpdatedAt: r.sourceUpdatedAt
  }));

  // ID estable basado en la fuente de mayor prioridad para la identidad
  const mainIdentity = sortByPriority(cluster, IDENTITY_PRIORITY)[0]!;
  const id = `st_${mainIdentity.source}_${mainIdentity.externalId}`;

  // Coordenadas
  const coordRef = pick(cluster, COORD_PRIORITY, "lat")?.source ?? cluster[0]!.source;
  const mainCoord = cluster.find(c => c.source === coordRef)!;
  
  // Nombres y aliases
  const mainName = pick(cluster, IDENTITY_PRIORITY, "name")?.value ?? "Estación Desconocida";
  const aliases = Array.from(new Set(cluster.map(r => r.name).filter(n => n && n !== mainName))) as string[];

  // Atributos y conflictos
  const attributes: ConsolidatedStation["attributes"] = {};
  const conflicts: ConsolidatedStation["conflicts"] = [];
  
  // Revisar conflicto de coordenadas
  const coordConflicts = cluster.filter(c => haversineKm(mainCoord, c) > 0.05);
  if (coordConflicts.length > 0) {
    conflicts.push({
      field: "coordinates",
      values: coordConflicts.map(c => ({ source: c.source, value: `${c.lat},${c.lon}` }))
    });
  }

  for (const r of cluster) {
    attributes[r.source] = r.attributes;
  }

  // Disponibilidad: solo fuentes con dato vivo
  const availRecord = sortByPriority(cluster, MISC_PRIORITY).find(r => r.availability.value !== "unknown");
  const availability = availRecord 
    ? { value: availRecord.availability.value, source: availRecord.source, at: availRecord.availability.at }
    : { value: "unknown" as const };

  return {
    id,
    name: mainName as string,
    aliases,
    lat: mainCoord.lat,
    lon: mainCoord.lon,
    coordSource: coordRef,
    address: pick(cluster, IDENTITY_PRIORITY, "address")?.value as any,
    operator: pick(cluster, IDENTITY_PRIORITY, "operator")?.value as string,
    network: pick(cluster, IDENTITY_PRIORITY, "network")?.value as string,
    brand: pick(cluster, IDENTITY_PRIORITY, "brand")?.value as string,
    openingHours: pick(cluster, MISC_PRIORITY, "openingHours")?.value as string,
    phone: pick(cluster, MISC_PRIORITY, "phone")?.value as string,
    website: pick(cluster, MISC_PRIORITY, "website")?.value as string,
    email: pick(cluster, MISC_PRIORITY, "email")?.value as string,
    pricing: pick(cluster, MISC_PRIORITY, "pricing")?.value as any,
    access: pick(cluster, MISC_PRIORITY, "access")?.value as any,
    services: Array.from(new Set(cluster.flatMap(r => r.services))),
    availability,
    connectors: mergeConnectors(cluster),
    sources: sourcesRef,
    attributes,
    conflicts,
    planning: { eligible: false, reasons: [] } // Se llena después
  };
}
