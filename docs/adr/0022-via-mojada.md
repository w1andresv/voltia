# 0022. Vía mojada: más rodadura y más auxiliares

- Estado: aceptada (que sea automática por defecto, pendiente de confirmar por el dueño)
- Fecha: 2026-10-03
- Fase: M2

## Contexto
Con la vía mojada la resistencia a la rodadura sube 15–25 %, y los limpiaparabrisas y el desempañador suman auxiliares. La energía v2 suponía siempre vía seca. Open-Meteo entrega la precipitación de la hora actual.

## Decisión
- `WeatherSnapshot.precipitationMm` (opcional) sale de `current=…,precipitation` de Open-Meteo.
- Condición del usuario `roadSurface`: `"auto"` (por defecto, o ausente), `"dry"` o `"wet"`. Opcional en el esquema: los viajes guardados antes de M2.2 se leen como `"auto"`. Selector en "Ajustes avanzados".
- `energy.wetRoad = { minPrecipMm: 0.3, crrFactor: 1.2, auxKw: 0.1 }` (estimado). La vía está mojada si el usuario la eligió así, o con `"auto"` si el pronóstico trae al menos `minPrecipMm`. Lo elegido por el usuario manda sobre el pronóstico, como la temperatura escrita manda sobre la del clima.
- `segmentEnergyV2` multiplica Crr por `crrFactor` y suma `auxKw` a los auxiliares cuando el tramo está mojado; las casetas con vía mojada también suman esos auxiliares. El perfil de energía recibe un `wetAt(km)`, hoy constante: la fase M3 lo vuelve por tramo.
- El plan lo dice en sus supuestos (`energy.wetRoad`, con su origen: pronóstico o elegido).
- La clave de la memoria del perfil de energía incluye la superficie de la vía.

## Consecuencias
- Solo con `ENERGY_ENGINE=v2`. Sin lluvia, el resultado es el de antes.
- Con `"auto"`, el clima de hoy en el punto medio de la ruta decide para todo el viaje, hasta que M3 traiga el clima por tramo.
- **Decisión pendiente del dueño:** si `"auto"` debe ser el valor por defecto o solo `"dry"` hasta que haya datos. Mientras tanto es `"auto"`.
- Los valores son de partida (`estimated`); se calibran con viajes bajo lluvia.
