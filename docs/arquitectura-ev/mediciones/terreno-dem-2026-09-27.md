# Terrain-RGB v1 contra Terrain-DEM v1 de Mapbox · 2026-09-27

Corrida por el dueño del producto en su computador con `npm run elevation:dem` (token real de Mapbox).

- **Ruta:** Villavicencio → Puerto López (`4.142,-73.626 → 4.085,-72.956`), 84,2 km, 106 muestras. Se pidió Piedecuesta → Vélez, pero `ORIGIN` y `DESTINATION` seguían definidas en la terminal por la prueba anterior.
- **Vehículo:** MG S5 EV, SOC de salida 80 %.

## 1. ¿Por qué API responde Terrain-DEM v1?

| API | Resultado |
|---|---|
| Raster Tiles API v4 (`/v4/mapbox.mapbox-terrain-dem-v1/…pngraw`) | **Responde**: PNG de 256×256 (79 744 bytes) |
| raster/v1 `.webp` (la de Mapbox GL JS) | HTTP 401 Unauthorized con este token |
| raster/v1 `.png` | HTTP 401 Unauthorized |

## 2. Las opciones sobre la ruta (una tesela = una consulta facturable)

| Opción | API | Teselas | px | m/píxel | Subida | Bajada | Mín | Máx | kWh | SOC llegada |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Terrain-RGB v1 · z12 (actual) | v4 | 9 | 256 | 38,1 | 7 | 264 | 180 | 442 | 9,3 | 60,3 % |
| Terrain-RGB v1 · z11 @2x | v4 @2x | **4** | 512 | 38,1 | 17 | 271 | 181 | 442 | 9,3 | 60,3 % |
| Terrain-DEM v1 · z12 | v4 | 9 | 256 | 38,1 | 7 | 264 | 180 | 442 | 9,3 | 60,3 % |
| Terrain-DEM v1 · z11 (sin @2x)* | v4 | 4 | 256 | 76,2 | 12 | 266 | 180 | 441 | 9,3 | 60,3 % |

\* Esta fila salió a la mitad de resolución porque el script no pidió @2x para Terrain-DEM. Ya se corrigió; la próxima corrida la trae a 38 m/píxel.

## 3. Diferencia de alturas contra Terrain-RGB v1 · z12 (mismos puntos)

| Opción | Media \|Δh\| | p95 \|Δh\| | Máx \|Δh\| |
|---|---:|---:|---:|
| Terrain-RGB v1 · z11 @2x | 0,2 m | 0,4 m | 1,3 m |
| Terrain-DEM v1 · z12 | 0 | 0 | 0 |
| Terrain-DEM v1 · z11 (sin @2x) | 0,2 m | 0,6 m | 2,7 m |

## Lectura
1. **Terrain-DEM v1 se sirve por la misma API que usamos hoy.** Es la Raster Tiles API v4, así que se factura igual: una consulta por tesela. La documentación sugería otra cosa (solo `raster/v1`), pero con el token del proyecto v4 responde.
2. **A zoom 12, Terrain-DEM y Terrain-RGB dieron exactamente las mismas alturas** en los 106 puntos (Δh = 0), con el mismo número de teselas. Cambiar de tileset no cambia ni el costo ni el resultado en esta ruta.
3. **`raster/v1` responde 401** con el token del servidor. No hace falta: v4 sirve los dos tilesets.
4. **Lo que sí baja la factura: zoom 11 con teselas @2x.**
   - Pide 4 teselas en vez de 9 (−56 %), con la misma resolución (38,1 m/píxel).
   - Las alturas cambian 0,2 m en promedio y 1,3 m como máximo.
   - La energía (9,3 kWh) y la batería al llegar (60,3 %) no cambian.
   - La subida pasa de 7 a 17 m: en llano, la histéresis de 5 m convierte diferencias de 1 m en unos metros más de desnivel.
5. **Pendiente:**
   - repetir en montaña (Piedecuesta → Vélez), donde las diferencias pesan más: `unset ORIGIN DESTINATION && npm run elevation:dem`;
   - confirmar en las estadísticas de Mapbox que una tesela @2x cuenta como una sola consulta.
