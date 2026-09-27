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

## Segunda corrida: montaña, Bucaramanga → Bogotá (421,6 km, 221 muestras)

Incluye el cañón del Chicamocha y la mayor parte del tramo Piedecuesta → Vélez. MG S5 EV, SOC de salida 80 %, sin estaciones (el SOC negativo es esperado). La fila de Terrain-DEM a zoom 11 todavía salió sin @2x: la corrida se hizo antes de la corrección del script.

| Opción | Teselas | px | m/píxel | ms | Subida | Bajada | Mín | Máx | kWh | SOC llegada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Terrain-RGB v1 · z12 | 49 | 256 | 38 | 833 | 9117 | 7529 | 538 | 3141 | 66,3 | −60,7 % |
| Terrain-RGB v1 · z11 @2x | **23** | 512 | 38 | 2012 | 9121 | 7536 | 538 | 3141 | 66,2 | −60,6 % |
| Terrain-DEM v1 · z12 | 49 | 256 | 38 | 3508 | 9117 | 7529 | 538 | 3141 | 66,3 | −60,7 % |
| Terrain-DEM v1 · z11 (sin @2x) | 23 | 256 | 76 | 975 | 8982 | 7396 | 540 | 3139 | 66,3 | −60,8 % |

| Diferencia contra Terrain-RGB v1 · z12 | Media \|Δh\| | p95 \|Δh\| | Máx \|Δh\| |
|---|---:|---:|---:|
| Terrain-RGB v1 · z11 @2x | 1,5 m | 4,4 m | 8,6 m |
| Terrain-DEM v1 · z12 | 0 | 0 | 0 |
| Terrain-DEM v1 · z11 (sin @2x) | 1,6 m | 4,7 m | 10,1 m |

**Lectura:**
- **Terrain-DEM v1 = Terrain-RGB v1** también en montaña: alturas idénticas en los 221 puntos, mismas 49 teselas y misma API. Cambiar de tileset no cambia ni el costo ni el resultado.
  - La diferencia de tiempo (3,5 s contra 0,8 s) es de una sola corrida en frío; no pesa, porque las teselas quedan en caché sin vencimiento.
- **Zoom 11 @2x:**
  - 23 teselas en vez de 49 (−53 %), con la misma resolución.
  - Las alturas cambian 1,5 m en promedio (máx. 8,6 m en laderas); la subida total cambia 4 m de 9117.
  - La energía baja 0,1 kWh de 66,3 (0,15 %).
- **A mitad de resolución** (zoom 11 sin @2x), la subida baja 135 m y las diferencias crecen poco. La energía casi no cambia, así que el resultado es poco sensible a este detalle.

## Decisión (2026-09-27)
Producción pasa a **Terrain-RGB v1, zoom 11 @2x** (`ModelParameters.elevation.terrain`).
- **Costo:** unas 5–6 teselas por cada 100 km de ruta nueva (antes ~12).
- **Tileset:** no se cambia a Terrain-DEM: da lo mismo. Si Mapbox retira Terrain-RGB, el cambio es solo el nombre del tileset, porque la API, el formato (PNG de 256/512 px, sin borde) y la fórmula son iguales.
- **Caché:** las teselas guardadas a zoom 12 no sirven para zoom 11, así que cada zona se vuelve a pedir una vez. Desde ahí cuesta la mitad.
- **Pendiente:** confirmar en las estadísticas de Mapbox que una tesela @2x cuenta como una sola consulta.
