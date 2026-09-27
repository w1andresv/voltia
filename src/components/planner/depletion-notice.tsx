"use client";

import { useQuery } from "@tanstack/react-query";
import type { BatteryDepletion } from "@/domain/types";
import { reversePlaceFn } from "@/server/actions/plan";

/** El nombre del lugar donde se agota la batería (Photon); sin nombre, solo el km. */
function usePlaceName(d: BatteryDepletion): string | null {
  const lat = Number(d.lat.toFixed(3));
  const lon = Number(d.lon.toFixed(3));
  const { data } = useQuery({
    queryKey: ["reverse-place", lat, lon],
    queryFn: () => reversePlaceFn({ data: { lat, lon } }),
    staleTime: Infinity,
    retry: false,
  });
  if (d.label) return d.label;
  // Si Photon no responde, devuelve las coordenadas como etiqueta: no aportan como nombre.
  return data?.context ? data.label : null;
}

export function depletionSentence(d: BatteryDepletion, place: string | null): string {
  return `Se queda sin batería en el km ${Math.round(d.km).toLocaleString("es-CO")}${place ? `, cerca de ${place}` : ""}.`;
}

/**
 * Dónde se agota la batería en un plan inviable, en vez de un SOC negativo
 * (auditoría 2026-09-27, propuesta A).
 */
export function DepletionNotice({
  depletion,
  className,
}: {
  depletion: BatteryDepletion;
  className?: string;
}) {
  const place = usePlaceName(depletion);
  return <span className={className}>{depletionSentence(depletion, place)} </span>;
}
