# 0027. Corredor contra la geometría fina de la ruta

- Estado: aceptada
- Fecha: 2026-10-03
- Fase: M5

## Contexto
El planificador ubicaba cada estación proyectándola contra las muestras de la ruta, que están a ~1–2 km y unen sus puntos con rectas: en una curva cerrada la cuerda se aparta de la vía, y una estación que sí está sobre la vía queda más lejos de lo que está (o fuera del radio de 12 km). Eso alarga el desvío estimado y puede dejar estaciones por fuera.

## Decisión
- `fineRouteLine` (`core/axis.ts`): la línea fina son los puntos de la geometría guardada (hasta 420, más que las muestras), cada uno con el **km medido en el eje de las muestras** (se proyecta sobre sus segmentos, avanzando sin retroceder). Así la línea y las muestras hablan del mismo km aunque la geometría reducida mida un poco distinto. Si la geometría no es más densa que las muestras, la línea son las muestras.
- `placeOnRoute(…, { line })`: con la línea, la estación se proyecta contra la vía (distancia lateral y `alongKm` reales) y se ubica en la **muestra más cercana por km** (`nearestSampleByKm`), que es donde el plan calcula la energía y coloca la parada (`stopEvents`, `kmAlongRoute`). Sin línea, todo igual que antes y el campo `alongKm` no aparece.
- Solo con el planificador v2: `buildPlan` (`engine: "v2"`), el filtro del corredor del servicio y las estaciones que mide la matriz (`measureDetours(…, fine)`, con el origen del desvío en el punto de la vía proyectado) la usan. El v1 sigue con las muestras.

## Consecuencias
- Caracterización del v2 regenerada (2 escenarios): llegada 13,2 → 12,4 % y 21,2 → 21,4 %, más el campo `alongKm` en las paradas.
- **El efecto en rutas reales es modesto.** La geometría guardada es la reducida (≤ 420 puntos) y las muestras van cada `max(0,8 km; distancia/220)`: la línea solo es más fina que las muestras en rutas de más de ~175 km, y su ventaja es del orden de unos cientos de metros en curvas cerradas. Donde el mecanismo se nota es en herraduras largas, que la prueba reproduce con un zigzag sintético (una estación en la punta, a 16 km de la cuerda y sobre la vía). Una mejora mayor exigiría guardar la geometría completa en el snapshot (peso: cientos de KB por ruta); no se hace.
- La parada sigue ubicada en una muestra (granularidad de 1–2 km): el km exacto de la estación (`alongKm`) queda disponible para mostrarlo, no se usa en el cálculo.
