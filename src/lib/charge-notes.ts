/**
 * Del ~85 % en adelante la potencia de carga cae mucho: por lo general el
 * último 10–15 % hasta el 100 % tarda más que el resto de la carga.
 */
export const SLOW_CHARGE_FROM_PCT = 85;

export const SLOW_TAIL_TEXT =
  "Por lo general, el último 10–15 % hasta el 100 % tarda más que el resto de la carga: la potencia baja a medida que la batería se llena.";

/** Aviso para un tope de carga en ruta alto; null si el tope no entra en la zona lenta. */
export function slowTailNoteForCap(maxSocTravel: number): string | null {
  return maxSocTravel > SLOW_CHARGE_FROM_PCT
    ? `Tope en ${Math.round(maxSocTravel)} %. ${SLOW_TAIL_TEXT}`
    : null;
}

/** Aviso para una parada que carga por encima del 85 %; null si no. */
export function slowTailNoteForStop(departSoc: number): string | null {
  return departSoc > SLOW_CHARGE_FROM_PCT + 0.5
    ? `Esta carga pasa del ${SLOW_CHARGE_FROM_PCT} %: ese último tramo suele tardar más (ya está incluido en el tiempo).`
    : null;
}
