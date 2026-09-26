/** Energía que entra (+) o sale (−) de la batería al llegar a una muestra: una carga o un desvío. */
export interface SocEvent {
  /** Índice de la muestra donde ocurre (después de recorrer el tramo que llega a ella). */
  atIndex: number;
  energyKwh: number;
}

/** Cómo acepta la batería la regeneración según su SOC (plan §4.5). */
export interface RegenAcceptance {
  /** Por debajo de este SOC la batería acepta toda la regeneración. */
  fullBelowPct: number;
  /** Desde este SOC no acepta nada; en medio, baja en línea. */
  zeroFromPct: number;
}
