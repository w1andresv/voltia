import type { ConsolidatedStation } from "./model";
import { isWithinColombia, hasValidCoords } from "./validate";
import { isDc } from "../charging";

const SUPPORTED_STANDARDS = ["ccs2", "ccs1", "chademo", "nacs", "gb_t", "type2", "type1"];

/**
 * Evalúa si una estación consolidada es elegible para ser usada en el planificador de rutas.
 */
export function evaluateEligibility(station: ConsolidatedStation): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Coordenadas
  if (!hasValidCoords(station.lat, station.lon)) {
    reasons.push("Coordenadas inválidas");
  } else if (!isWithinColombia(station.lat, station.lon)) {
    reasons.push("Fuera del área de cobertura (Colombia)");
  }

  // Estado operativo
  // station.availability.value ya debería considerar el estado,
  // o si viene de OSM con prefix lo descartó antes,
  // pero si la DB de comunidad lo marcó 'offline'
  if (station.availability.value === "offline") {
    reasons.push("Reportada fuera de servicio");
  }

  // Acceso
  if (station.access === "private") {
    reasons.push("Acceso privado");
  }

  // Conectores válidos para planificación
  // Debe tener al menos uno soportado, con potencia (reportada o asumida por merge.ts) y confirmado
  const validConnectors = station.connectors.filter(c => {
    if (!SUPPORTED_STANDARDS.includes(c.standard)) return false;
    if (c.powerKw == null) return false; // Estándar sin default conocido (p.ej. "other")
    if (!c.confirmed) return false;
    return true;
  });

  if (validConnectors.length === 0) {
    const hasUnconfirmed = station.connectors.some(c => !c.confirmed);
    const hasNoPower = station.connectors.some(c => c.powerKw == null);
    if (hasUnconfirmed) {
      reasons.push("Conectores no confirmados por fuentes oficiales o comunidad");
    } else if (hasNoPower) {
      reasons.push("Sin potencia de carga reportada");
    } else {
      reasons.push("Sin conectores compatibles conocidos");
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}
