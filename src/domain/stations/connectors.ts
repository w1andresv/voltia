import type { CurrentType, ExtendedConnectorType } from "./model";

const CONNECTOR_BY_NAME: Array<[RegExp, ExtendedConnectorType]> = [
  [/ccs\s*combo\s*2|ccs2|combo\s*2|type2_combo/i, "ccs2"],
  [/ccs\s*combo\s*1|ccs1|combo\s*1|type1_combo/i, "ccs1"],
  [/type\s*2|mennekes|iec\s*62196/i, "type2"],
  [/type\s*1|j1772/i, "type1"],
  [/chademo/i, "chademo"],
  [/nacs|tesla\s*(supercharger|mag|nacs)|sae\s*j3400/i, "nacs"],
  [/gb\s*\/?\s*t|gbt/i, "gb_t"],
  [/schuko|en\s*1636|wall.*plug|standard.*plug/i, "schuko"],
  [/tesla.*(destination|wall.*connector)/i, "tesla_destination"],
];

/**
 * Normaliza una etiqueta de conector cruda a uno de los estándares soportados.
 */
export function standardizeConnector(rawLabel: string): ExtendedConnectorType {
  const s = rawLabel.trim();
  if (!s) return "other";
  for (const [re, type] of CONNECTOR_BY_NAME) {
    if (re.test(s)) return type;
  }
  return "other";
}

/**
 * Retorna el tipo de corriente estándar asociado a un tipo de conector.
 */
export function currentFromStandard(standard: ExtendedConnectorType): CurrentType | null {
  switch (standard) {
    case "ccs2":
    case "ccs1":
    case "chademo":
    case "nacs":
    case "gb_t":
      return "DC";
    case "type2":
    case "type1":
    case "schuko":
    case "tesla_destination":
      return "AC";
    case "other":
    default:
      return null;
  }
}

const DEFAULT_KW_BY_STANDARD: Partial<Record<ExtendedConnectorType, number>> = {
  ccs1: 50,
  ccs2: 50,
  chademo: 50,
  gb_t: 50,
  nacs: 150,
  type1: 22,
  type2: 22,
};

/** Potencia asumida cuando ninguna fuente la reporta, hasta tener valores reales por estación. */
export function defaultKwForStandard(standard: ExtendedConnectorType): number | null {
  return DEFAULT_KW_BY_STANDARD[standard] ?? null;
}
