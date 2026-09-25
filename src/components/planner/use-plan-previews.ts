import { useDeferredValue, useMemo } from "react";
import { previewDelta, type PlanPreview } from "@/domain/conditions-advice";
import type { DrivingStyle, PlanningMode, SafetyMode, TripConditions } from "@/domain/types";
import { rankedPlansFor, usePlanner } from "@/lib/store";

export const STYLES: { id: DrivingStyle; label: string; hint: string }[] = [
  { id: "efficient", label: "Eficiente", hint: "≈ −10 % energía, ~7 % más lenta" },
  { id: "normal", label: "Normal", hint: "Velocidad de la ruta" },
  { id: "sport", label: "Deportiva", hint: "≈ +15 % energía, ~6 % más rápida" },
];

export const MARGINS: { id: SafetyMode; label: string }[] = [
  { id: "conservative", label: "20 %" },
  { id: "normal", label: "15 %" },
  { id: "low", label: "10 %" },
  { id: "custom", label: "Otro" },
];

export const MARGIN_NAME: Record<SafetyMode, string> = {
  conservative: "Conservador",
  normal: "Normal",
  low: "Bajo",
  custom: "Personalizado",
};

export const MODES: { id: PlanningMode; label: string; hint: string }[] = [
  { id: "fastest", label: "Más rápida", hint: "Menos tiempo total, cargadores de alta potencia." },
  {
    id: "efficient",
    label: "Más eficiente",
    hint: "Ruta y cargadores que menos energía gastan (tu forma de conducir la fija el estilo).",
  },
  { id: "fewer_stops", label: "Menos paradas", hint: "Cargas más largas, menos detenciones." },
  {
    id: "safer",
    label: "Más segura",
    hint: "Carga con holgura (≥ 70 %) y prefiere la ruta con más batería mínima.",
  },
  {
    id: "custom",
    label: "Personalizada",
    hint: "Sin ajustes propios: usa tu margen y estilo tal cual.",
  },
];

type Group = "mode" | "margin" | "style";

export interface PlanPreviews {
  mode: Partial<Record<PlanningMode, string | null>>;
  margin: Partial<Record<SafetyMode, string | null>>;
  style: Partial<Record<DrivingStyle, string | null>>;
}

function toPreview(p: PlanPreview | undefined): PlanPreview | null {
  return p
    ? {
        energyKwh: p.energyKwh,
        totalMinutes: p.totalMinutes,
        stops: p.stops,
        arrivalSoc: p.arrivalSoc,
        feasible: p.feasible,
      }
    : null;
}

/**
 * Vista previa: cómo cambiaría el plan recomendado con cada opción, recalculado
 * sobre las rutas ya encontradas (sin pedir rutas nuevas). Solo si `enabled` y
 * ya hay un viaje planificado, y solo para los grupos pedidos. Usa las
 * condiciones diferidas para que el clic en una opción responda primero.
 */
export function usePlanPreviews(groups: readonly Group[], enabled = true): PlanPreviews | null {
  const geo = usePlanner((s) => s.geo);
  const origin = usePlanner((s) => s.origin);
  const destination = usePlanner((s) => s.destination);
  const vehicles = usePlanner((s) => s.vehicles);
  const selectedVehicleId = usePlanner((s) => s.selectedVehicleId);
  const conditions = useDeferredValue(usePlanner((s) => s.conditions));
  const key = groups.join(",");
  return useMemo(() => {
    if (!enabled || !geo?.routes.length || !origin || !destination) return null;
    const inputs = { geo, origin, destination, vehicles, selectedVehicleId, conditions };
    const with_ = (p: Partial<TripConditions>) =>
      toPreview(rankedPlansFor(inputs, { ...conditions, ...p })[0]);
    const current = with_({});
    if (!current) return null;
    const text = (p: Partial<TripConditions>) => {
      const next = with_(p);
      return next ? previewDelta(current, next) : null;
    };
    const wants = new Set(key.split(","));
    return {
      mode: wants.has("mode")
        ? Object.fromEntries(
            MODES.filter((m) => m.id !== conditions.planningMode).map((m) => [
              m.id,
              text({ planningMode: m.id }),
            ]),
          )
        : {},
      margin: wants.has("margin")
        ? Object.fromEntries(
            MARGINS.filter((m) => m.id !== "custom" && m.id !== conditions.safetyMode).map((m) => [
              m.id,
              text({ safetyMode: m.id }),
            ]),
          )
        : {},
      style: wants.has("style")
        ? Object.fromEntries(
            STYLES.filter((st) => st.id !== conditions.drivingStyle).map((st) => [
              st.id,
              text({ drivingStyle: st.id }),
            ]),
          )
        : {},
    };
  }, [key, enabled, geo, origin, destination, vehicles, selectedVehicleId, conditions]);
}
