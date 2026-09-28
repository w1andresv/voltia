import { catalogById } from "@/domain/vehicles";
import { DRIVER_KG, PERSON_KG } from "@/domain/types";
import { formatKm, formatKw, formatKwh, formatPct } from "@/lib/format";
import { BUC_BOG } from "./bucaramanga-bogota";

/** Vehículo y condiciones con que se calculó el ejemplo del landing. */
const STYLE = { efficient: "Eficiente", normal: "Normal", sport: "Deportivo" } as const;
const AC = { off: "Apagado", eco: "Eco", normal: "Normal", max: "Máximo" } as const;
const REGEN = { low: "Baja", medium: "Media", high: "Alta" } as const;
const MARGIN = { conservative: "Conservador", normal: "Normal", low: "Bajo" } as const;
const STRATEGY = { fastest: "Más rápida", fewer: "Menos paradas", safer: "Más segura" } as const;
const MARGIN_PCT = { conservative: 20, normal: 15, low: 10 } as const;
const CONNECTOR: Record<string, string> = {
  ccs2: "CCS2 (Combo 2)",
  type2: "Tipo 2",
  chademo: "CHAdeMO",
  gbt_dc: "GB/T DC",
  ccs1: "CCS1",
  type1: "Tipo 1",
};
const kg = (n: number) => `${n.toLocaleString("es-CO")} kg`;

function Facts({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="grid content-start gap-2">
      <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-subtle">
        {title}
      </h3>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="col-span-2 grid grid-cols-subgrid border-b border-border py-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 text-right font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TripFacts() {
  const v = catalogById(BUC_BOG.vehicleId);
  if (!v) return null;
  const c = BUC_BOG.conditions;
  const extra = DRIVER_KG + c.passengers * PERSON_KG + c.luggageKg;

  const vehicle: [string, string][] = [
    ["Modelo", `${v.brand} ${v.model} ${v.version} ${v.year}`],
    ["Batería", formatKwh(v.batteryKwh)],
    ["Autonomía anunciada", formatKm(v.rangeKm)],
    ["Peso en vacío", kg(v.weightKg)],
    ["Motor", formatKw(v.motorKw)],
    ["Carga rápida máxima", `${formatKw(v.dcMaxKw)} DC · ${formatKw(v.acMaxKw)} AC`],
    ["Conectores", v.connectors.map((k) => CONNECTOR[k] ?? k).join(" y ")],
    [
      "Resistencia al aire (Cd·A)",
      `${(v.dragAreaM2 ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 2 })} m²`,
    ],
    ["Regeneración máxima", v.maxRegenPowerKw ? formatKw(v.maxRegenPowerKw) : "—"],
    ["Carga máxima en ruta", formatPct(v.maxSocTravel)],
    ["Mínimo recomendado", formatPct(v.minSocRecommended)],
  ];
  const trip: [string, string][] = [
    ["Ocupantes", `Conductor + ${c.passengers} ${c.passengers === 1 ? "pasajero" : "pasajeros"}`],
    ["Equipaje", kg(c.luggageKg)],
    ["Peso total", `${kg(v.weightKg + extra)} (+${kg(extra)})`],
    ["Manejo", STYLE[c.drivingStyle]],
    ["Aire acondicionado", AC[c.ac]],
    ["Temperatura", `${c.temperatureC} °C`],
    ["Regeneración", REGEN[c.regenLevel]],
    ["Batería al salir", formatPct(c.initialSoc)],
    ["Llegada pedida", formatPct(c.arrivalSoc)],
    ["Margen de seguridad", `${MARGIN[c.safetyMode]} (${MARGIN_PCT[c.safetyMode]} %)`],
    ["Estrategia", STRATEGY[c.planningMode]],
  ];

  return (
    <div className="grid gap-6 border-t border-border pt-4 md:grid-cols-2 md:gap-10">
      <Facts title="Vehículo" rows={vehicle} />
      <Facts title="Condiciones del viaje" rows={trip} />
    </div>
  );
}
