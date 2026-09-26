import type { NormalizedRecord } from "./model";

// Bounding box para Colombia (con un pequeño margen)
const CO_BBOX = {
  minLat: -4.5,
  maxLat: 13.5,
  minLon: -82.0,
  maxLon: -66.0,
};

export function hasValidCoords(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function isWithinColombia(lat: number, lon: number): boolean {
  return (
    lat >= CO_BBOX.minLat &&
    lat <= CO_BBOX.maxLat &&
    lon >= CO_BBOX.minLon &&
    lon <= CO_BBOX.maxLon
  );
}

export function validateRecord(
  record: NormalizedRecord,
  existingInSameSource: NormalizedRecord[] = []
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Coordenadas
  if (!hasValidCoords(record.lat, record.lon)) {
    reasons.push("Coordenadas inválidas (no numéricas o 0,0)");
  } else if (!isWithinColombia(record.lat, record.lon)) {
    reasons.push("Fuera de Colombia");
  }

  // Nombre u operador
  const name = (record.name || "").trim();
  const operator = (record.operator || record.network || record.brand || "").trim();
  if (!name && !operator) {
    reasons.push("Sin nombre ni operador");
  }

  // Duplicado exacto en la misma fuente (mismo externalId)
  if (existingInSameSource.some((e) => e.externalId === record.externalId && e !== record)) {
    reasons.push("Duplicado exacto en la fuente");
  }

  // Estado operativo
  // OSM usa lifecycle prefixes (abandoned:, construction:, etc)
  const isLifecyclePrefix = /^(abandoned|disused|construction|planned|proposed)/i.test(name);
  if (isLifecyclePrefix) {
    reasons.push("En construcción o fuera de servicio (ciclo de vida)");
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}
