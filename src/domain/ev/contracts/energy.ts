import type { RouteSample } from "../../types";

/**
 * Perfil de energía por muestra, independiente del SOC (F3). La regeneración es
 * la POTENCIAL: cuánto se podría recuperar con la batería lejos de llena. Cuánto
 * acepta la batería lo decide el SOCEngine.
 *  - energyGrossKwh: tracción más auxiliares del tramo que llega a esta muestra.
 *  - energyRegenKwh: regeneración potencial del tramo.
 *  - energyKwh: gross − regeneración potencial.
 *  - cumulativeKwh: suma de energyKwh desde el origen.
 */
export type EnergySample = Omit<RouteSample, "soc">;
