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

## Ruta de llano: Villavicencio → Puerto López (con la corrección de ráfaga)

Corrida el 2026-09-27 con `ORIGIN=4.142,-73.626 DESTINATION=4.085,-72.956`, 84,2 km, MG S5 EV, SOC de salida 80 %.

| Fuente pedida | Usada | Puntos | Consultas | ms | Subida (m) | Bajada (m) | Mín (m) | Máx (m) | kWh | SOC llegada |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| open-meteo | open-meteo | 96 | 1 | 846 | 2 | 197 | 184 | 435 | 9,5 | 59,8 % |
| open-meteo-adaptive | open-meteo/adaptive | 98 | 2 | 390 | 6 | 261 | 182 | 440 | 9,5 | 59,8 % |
| mapbox-terrain | mapbox-terrain/mesh | 844 | 9 | 951 | 7 | 264 | 180 | 442 | 9,5 | 59,8 % |
| mapbox-terrain (2.ª vez) | mapbox-terrain/mesh | 844 | 0 | 4 | 7 | 264 | 180 | 442 | 9,5 | 59,8 % |

**Lectura:**
- **En llano Mapbox no inventa subidas:** 7 m en 84 km, frente a 2 m con Open-Meteo, y la misma energía. El ruido del terreno de alrededor no aparece donde no hay laderas.
  - Esto no descarta el efecto de ladera en montaña, que solo aparece en pendiente.
  - Aun así, el doble de subida en Bucaramanga → Bogotá se explica sobre todo por detalle que los 96 puntos no ven.
- **`open-meteo-adaptive` ya funciona** con la corrección de ráfaga: 2 consultas, sin respaldo.
  - En llano casi no refina (98 puntos), porque ningún tramo cambia más de 15 m entre puntos.
  - Su bajada (261 m) ya coincide con la de Mapbox (264 m); la fija de 96 puntos daba 197 m.
- **Costo:** 9 teselas para 84 km, unas 11 cada 100 km, en línea con la ruta de montaña.

## Pendiente
- Repetir Bucaramanga → Bogotá con la corrección, para tener la fila de `open-meteo-adaptive` en montaña.
- Contrastar la subida de Bucaramanga → Bogotá con una referencia externa (GPS de un viaje real o un planificador de ciclismo).
