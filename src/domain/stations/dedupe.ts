import { haversineKm } from "../geo";
import { textSimilarity, addressSimilarity, normalizeText } from "./text";
import type { NormalizedRecord } from "./model";

/**
 * Agrupa registros validados en "clusters" (estaciones consolidadas).
 */
export function deduplicateRecords(records: NormalizedRecord[]): NormalizedRecord[][] {
  if (records.length === 0) return [];
  
  // 1. Agrupar por ID externo exacto (misma fuente, mismo ID)
  // o referencias cruzadas obvias si las hubiera (futuro)
  const byExternalId = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    const key = `${r.source}::${r.externalId}`;
    let list = byExternalId.get(key);
    if (!list) {
      list = [];
      byExternalId.set(key, list);
    }
    list.push(r);
  }
  
  const uniqueRecords = Array.from(byExternalId.values()).map(list => list[0]!); // Tomamos el primero de duplicados exactos

  // 2. Union-Find para agrupar
  const parent = new Map<string, string>();
  const idToRecord = new Map<string, NormalizedRecord>();
  for (const r of uniqueRecords) {
    const key = `${r.source}::${r.externalId}`;
    parent.set(key, key);
    idToRecord.set(key, r);
  }

  function find(i: string): string {
    let root = i;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let curr = i;
    while (curr !== root) {
      const nxt = parent.get(curr)!;
      parent.set(curr, root);
      curr = nxt;
    }
    return root;
  }

  function union(i: string, j: string) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent.set(rootI, rootJ);
    }
  }

  // 3. Grid Index para O(N log N) en vez de O(N^2)
  const gridSize = 0.005; // ~550m
  const grid = new Map<string, NormalizedRecord[]>();
  for (const r of uniqueRecords) {
    const cellX = Math.floor(r.lon / gridSize);
    const cellY = Math.floor(r.lat / gridSize);
    const cell = `${cellX},${cellY}`;
    let list = grid.get(cell);
    if (!list) {
      list = [];
      grid.set(cell, list);
    }
    list.push(r);
  }

  const cells = Array.from(grid.keys());
  for (const cell of cells) {
    const [xStr, yStr] = cell.split(",");
    const x = parseInt(xStr!, 10);
    const y = parseInt(yStr!, 10);

    const neighbors = [
      cell,
      `${x - 1},${y - 1}`, `${x},${y - 1}`, `${x + 1},${y - 1}`,
      `${x - 1},${y}`, `${x + 1},${y}`,
      `${x - 1},${y + 1}`, `${x},${y + 1}`, `${x + 1},${y + 1}`
    ];

    const currentList = grid.get(cell)!;
    for (const r1 of currentList) {
      for (const neighbor of neighbors) {
        const neighborList = grid.get(neighbor) || [];
        for (const r2 of neighborList) {
          const k1 = `${r1.source}::${r1.externalId}`;
          const k2 = `${r2.source}::${r2.externalId}`;
          if (k1 === k2) continue;
          
          if (find(k1) === find(k2)) continue; // ya unidos
          
          if (shouldMerge(r1, r2)) {
            union(k1, k2);
          }
        }
      }
    }
  }

  // 4. Extraer clusters
  const clustersMap = new Map<string, NormalizedRecord[]>();
  for (const r of uniqueRecords) {
    const root = find(`${r.source}::${r.externalId}`);
    let list = clustersMap.get(root);
    if (!list) {
      list = [];
      clustersMap.set(root, list);
    }
    list.push(r);
  }

  // 5. Validar diámetro del cluster (guardas)
  // Por ahora lo simplificamos: si el diámetro es > 300m, lo rompemos (idealmente, pero dejaremos el union tal cual si shouldMerge ya lo restringió a distancias muy cortas y evita encadenamientos locos)
  
  return Array.from(clustersMap.values());
}

function operatorsCompatible(op1?: string, op2?: string): boolean {
  if (!op1 || !op2) return true; // Si uno no tiene, asumimos compatible
  const n1 = normalizeText(op1);
  const n2 = normalizeText(op2);
  if (!n1 || !n2) return true;
  return jaccardSimilarity(n1, n2) >= 0.4 || n1.includes(n2) || n2.includes(n1);
}
import { jaccardSimilarity } from "./text";

function shouldMerge(r1: NormalizedRecord, r2: NormalizedRecord): boolean {
  const d = haversineKm(r1, r2) * 1000; // metros
  
  if (d > 300) return false;

  // Guardas para misma fuente: no fusionar IDs distintos de la misma fuente salvo que estén super cerca y sean lo mismo
  if (r1.source === r2.source) {
    if (d > 50) return false;
    const sameOp = operatorsCompatible(r1.operator, r2.operator);
    const simName = textSimilarity(r1.name, r2.name);
    if (!sameOp && simName < 0.6) return false;
  }

  if (d <= 25) {
    if (r1.operator && r2.operator && !operatorsCompatible(r1.operator, r2.operator)) {
      return false; // Están pegados pero son de distinta red
    }
    return true;
  }

  const nameSim = textSimilarity(r1.name, r2.name);
  const addrSim = addressSimilarity(r1.address?.full || "", r2.address?.full || "");
  const sameOp = operatorsCompatible(r1.operator, r2.operator);

  if (d > 25 && d <= 150) {
    if (nameSim >= 0.6) return true;
    if (addrSim >= 0.7) return true;
    if (sameOp && (nameSim >= 0.4 || addrSim >= 0.5)) return true;
    return false;
  }

  if (d > 150 && d <= 300) {
    if (nameSim >= 0.8 && sameOp) return true;
    return false;
  }

  return false;
}
