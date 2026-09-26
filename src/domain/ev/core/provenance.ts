/**
 * Procedencia de cada dato del vehículo o del modelo (especificación v2, §3.1).
 * Un valor sin fuente real se marca `estimated` y aparece en los supuestos del plan.
 */
export type DataSource = "manufacturer" | "external_source" | "calculated" | "estimated" | "configurable";

export interface SourcedValue<T> {
  value: T;
  source: DataSource;
  /** URL, documento o ADR que respalda el valor. */
  reference?: string;
  notes?: string;
}

export function sourced<T>(
  value: T,
  source: DataSource,
  extra: { reference?: string; notes?: string } = {},
): SourcedValue<T> {
  return { value, source, ...extra };
}

/** true si el valor no viene del fabricante, de una fuente externa ni de un cálculo con datos reales. */
export function isEstimated(v: Pick<SourcedValue<unknown>, "source">): boolean {
  return v.source === "estimated";
}
