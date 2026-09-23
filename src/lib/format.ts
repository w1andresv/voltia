const nf0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf1f = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formatKm(km: number, digits = 0): string {
  if (!Number.isFinite(km)) return "—";
  const v = digits === 0 ? nf0.format(Math.round(km)) : nf1.format(km);
  return `${v} km`;
}

export function formatKwh(kwh: number, forced = false): string {
  if (!Number.isFinite(kwh)) return "—";
  return `${(forced ? nf1f : nf1).format(kwh)} kWh`;
}

export function formatKwhPer100(kwh: number): string {
  if (!Number.isFinite(kwh)) return "—";
  return `${nf1.format(kwh)} kWh/100 km`;
}

export function formatKw(kw: number): string {
  if (!Number.isFinite(kw)) return "—";
  return `${nf0.format(Math.round(kw))} kW`;
}

export function formatPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${nf0.format(Math.round(pct))} %`;
}

export function formatMinutes(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "—";
  const rounded = Math.round(total);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h <= 0) return `${m} min`;
  if (h > 0 && m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatElevation(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return `${nf0.format(Math.round(m))} m`;
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "COP" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${nf1.format(amount)} ${currency}`;
  }
}

export function formatClock(minutes: number): string {
  return formatMinutes(minutes);
}

export function formatUpdatedAt(iso?: string): string {
  if (!iso) return "Sin fecha de actualización";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  return new Intl.DateTimeFormat(
    "es-CO",
    dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(d);
}
