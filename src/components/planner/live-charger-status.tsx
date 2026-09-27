"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConsolidatedStation } from "@/domain/stations/model";
import { CONNECTOR_LABEL, type ConnectorType, type StationAvailability } from "@/domain/types";
import { formatKw } from "@/lib/format";

/** Igual que la caché del detalle en el servidor: el estado de un cargador cambia seguido. */
const DETAIL_STALE_MS = 2 * 60 * 1000;

async function fetchDetail(id: string): Promise<ConsolidatedStation | null> {
  const res = await fetch(`/api/stations/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as ConsolidatedStation;
}

/** Blaze informa si un cargador funciona, no si está libre: "en servicio", no "disponible". */
const STATUS_LABEL: Record<StationAvailability, string> = {
  available: "En servicio",
  occupied: "Ocupado",
  offline: "Fuera de servicio",
  unknown: "Sin dato",
};

function labelOf(standard: string): string {
  return CONNECTOR_LABEL[standard as ConnectorType] ?? standard;
}

/**
 * Estado de cada cargador de una estación de Blaze (ADR-0008, D9): se pide el
 * detalle solo cuando el usuario abre la ficha, no para todo el mapa.
 */
export function LiveChargerStatus({ stationId }: { stationId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["station-detail", stationId],
    queryFn: () => fetchDetail(stationId),
    staleTime: DETAIL_STALE_MS,
  });
  if (isPending)
    return <div className="text-xs text-muted">Consultando el estado de los cargadores…</div>;
  if (isError || !data) return null;
  const connectors = data.connectors.filter((c) => c.quantity != null);
  if (!connectors.length) return null;
  return (
    <div className="space-y-0.5 text-xs">
      <div className="text-muted">Estado de los cargadores</div>
      {connectors.map((c) => (
        <div key={c.standard} className="flex justify-between gap-2">
          <span className="text-fg">
            {labelOf(c.standard)} {c.powerKw != null ? formatKw(c.powerKw) : ""} ×{c.quantity}
          </span>
          <span
            className={
              c.status === "available"
                ? "text-ok"
                : c.status === "offline"
                  ? "text-danger"
                  : "text-muted"
            }
          >
            {STATUS_LABEL[c.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
