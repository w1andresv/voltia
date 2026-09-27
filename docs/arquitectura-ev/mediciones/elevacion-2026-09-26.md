# Medición de fuentes de elevación · 2026-09-26 (O4)

Corrida por el dueño del producto en su computador con `.env.local` (token real de Mapbox):

```bash
ORIGIN=7.1193,-73.1227 DESTINATION=4.711,-74.0721 npm run elevation:compare
```

- **Ruta:** Bucaramanga → Bogotá, 421,6 km.
- **Vehículo:** MG S5 EV, SOC de salida 80 %.
- **Estaciones:** el script no carga estaciones, así que el SOC de llegada negativo es esperado. Sirve para comparar fuentes, no como plan.

| Fuente pedida | Usada | Puntos | Consultas | ms | Subida (m) | Bajada (m) | Mín (m) | Máx (m) | kWh | SOC llegada |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| open-meteo | open-meteo | 96 | 1 | 820 | 4303 | 2686 | 658 | 3083 | 62,6 | −52,9 % |
| open-meteo-adaptive | open-meteo (respaldo) | 96 | 27 | 4353 | 4303 | 2686 | 658 | 3083 | 62,6 | −52,9 % |
| mapbox-terrain | mapbox-terrain/mesh | 4218 | 49 | 1018 | 9117 | 7529 | 538 | 3141 | 66,8 | −61,9 % |
| mapbox-terrain (2.ª vez) | mapbox-terrain/mesh | 4218 | 0 | 8 | 9117 | 7529 | 538 | 3141 | 66,8 | −61,9 % |

## Lectura

1. **El tileset `mapbox.terrain-rgb` funciona** con el token del proyecto. No hace falta cambiarlo a `mapbox.mapbox-terrain-dem-v1`, así que §5.1.5 queda cerrado.
2. **La caché funciona.** La segunda corrida de la misma ruta hizo 0 consultas y tardó 8 ms. Como la caché no vence (D12), cada zona se paga una sola vez.
3. **Costo:** una ruta nueva de 421 km pidió **49 teselas** (zoom 12), unas 12 cada 100 km. Las rutas que comparten tramos reusan teselas. Esto es el insumo de O6.
4. **Desnivel neto coherente:** +1617 m con Open-Meteo y +1588 m con Mapbox. Bucaramanga está a ~960 m y Bogotá a ~2600 m, unos +1640 m.
5. **La subida acumulada se duplica:** 9117 m con Mapbox frente a 4303 m con Open-Meteo.
   - Con 96 puntos (uno cada 4,4 km) Open-Meteo no ve las subidas y bajadas cortas; el mínimo de 658 m frente a 538 m muestra que corta el fondo del cañón del Chicamocha.
   - Parte de la diferencia puede venir del terreno junto a la vía: a zoom 12 un píxel mide ~30 m y en ladera toma la montaña, no la banca. Hay que validarlo contra una referencia confiable de la misma ruta. Si sobra, el ajuste es la histéresis (`ModelParameters.elevation.dense`, hoy 5 m) o el suavizado (300 m), no la fuente.
6. **Energía:** 66,8 kWh frente a 62,6 kWh (+6,7 %). La bajada extra se recupera en gran parte con regeneración, así que duplicar la subida sube la energía mucho menos.
7. **`open-meteo-adaptive` no llegó a correr.**
   - Las consultas en paralelo (4 a la vez) chocaron con el límite de ráfaga de Open-Meteo, y los lotes pasaron al respaldo OpenTopoData.
   - OpenTopoData también respondió 429 (una consulta por segundo en el servicio gratuito), así que la estrategia cayó a la fija de 96 puntos.
   - **Corregido:** 2 lotes a la vez, reintento con pausa ante 429 en Open-Meteo, OpenTopoData de a una consulta por segundo y URL recortada en los errores. Hay que repetir la corrida para tener esa fila.

## Pendiente
- Repetir `npm run elevation:compare` con la corrección para medir `open-meteo-adaptive`.
- Correr una ruta de llano (p. ej. Villavicencio → Puerto López, en los Llanos) para ver que Mapbox no infla el desnivel donde no hay montaña.
- Contrastar la subida de Bucaramanga → Bogotá con una referencia externa (GPS de un viaje real o un planificador de ciclismo).
