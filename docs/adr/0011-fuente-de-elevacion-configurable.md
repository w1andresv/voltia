# 0011. Fuente de elevación configurable (B6)

- Estado: aceptada (la fuente definitiva se elige comparando; ver Consecuencias)
- Fecha: 2026-09-26
- Fase: F2b

## Contexto
B6: hoy se piden 96 puntos por ruta a Open-Meteo, uno cada ~3 km en 300 km, y en montaña eso aplana el desnivel. La especificación pide una malla de 100 m. Las opciones eran teselas de terreno de Mapbox con caché, o una malla adaptativa en Open-Meteo. El dueño del producto prefiere dejar la obtención desacoplada y probar las dos con una variable de entorno.

## Decisión
- `ELEVATION_SOURCE = open-meteo | open-meteo-adaptive | mapbox-terrain`, por defecto `open-meteo`, que da el mismo resultado que antes. `container.ts` arma el proveedor y la estrategia.
- **Dominio** (`engines/elevation`): tres estrategias de muestreo.
  - fija: 96 muestras, sin cambios;
  - malla: `elevationMesh`, un punto cada `mesh.spacingM` = 100 m sobre la geometría;
  - adaptativa: `adaptiveRefinement`, un punto por km y cada 200 m donde la altura cambia más de 15 m entre dos puntos. Tope de 1500 puntos por ruta, priorizando los tramos con más cambio.

  Las dos densas se aplican con `applyDenseElevationProfile`: suavizado por distancia (300 m), altura de cada muestra interpolada y desnivel con histéresis de 5 m sobre el perfil denso. Todos los valores están en `ModelParameters.elevation`.
- **Aplicación** (`plan-trip/elevation-profile.ts`): pide los puntos al puerto según la estrategia. Si el principal falla, usa Open-Meteo con la estrategia fija; si todo falla, la ruta queda plana y el plan avisa, como antes.
- **Infraestructura:**
  - `MapboxTerrainElevationProvider`: teselas terrain-RGB (`mapbox.terrain-rgb`, zoom 12) con caché de 30 días en la Data Cache de Next y las últimas 96 teselas en memoria. El decodificador PNG es propio (`png.ts`), sin dependencias nativas.
  - Open-Meteo ahora pide en lotes de 100 puntos (hasta 2 a la vez; ver la medición de 2026-09-26).
- **Medición:** una línea `[elevation]` por planificación (fuente, puntos, ms, desnivel) y `npm run elevation:compare`, que corre las tres fuentes sobre la misma ruta y compara consultas, tiempo, desnivel, energía y SOC de llegada.
- El snapshot guarda la fuente usada (`open-meteo`, `open-meteo/adaptive`, `mapbox-terrain/mesh`).

## Consecuencias
- Cambiar de fuente es una variable; el dominio no sabe de dónde vienen las alturas. Blaze (ADR-0008) entraría como otro `ElevationProvider`.
- Con `open-meteo-adaptive` o `mapbox-terrain` cambian el desnivel y el consumo en montaña. Conviene probarlas con `PLANNER_ENGINE=shadow`, mirar el log y correr `elevation:compare` en rutas de montaña antes de elegir.
- Costo: `mapbox-terrain` cuenta como uso de teselas de Mapbox (revisar el plan contratado); la caché lo reduce con el uso. `open-meteo-adaptive` hace varias consultas por ruta; el uso gratuito de Open-Meteo es no comercial.
- Pendiente de F2b: limpieza de túneles y puentes, límite de pendiente y error tipado `ELEVATION_UNAVAILABLE`. El tileset `mapbox.terrain-rgb` se verifica al correr `elevation:compare` con un token real; si Mapbox pide `mapbox.mapbox-terrain-dem-v1`, se cambia en `ModelParameters.elevation.terrain.tileset`.

## Decisión del dueño del producto (2026-09-26, D1)
La fuente por defecto pasa a ser **`mapbox-terrain`**. Queda por hacer el cambio de código (guía 05, §5.1.1) y verificar con `npm run elevation:compare` que el tileset responde y que el costo cabe en el plan de Mapbox (O4, O6).

## Sesión B (2026-09-26)
- **Fuente por defecto:** `ELEVATION_SOURCE` es `mapbox-terrain` (D1).
- **Caché sin vencimiento (D12):** la elevación no cambia, así que las teselas y las consultas de Open-Meteo quedan en la Data Cache de Next con `revalidate: false`, compartidas por todos los usuarios y entre despliegues. Se pidió "caché en cookies", pero las cookies no sirven: ~4 KB cada una, viajan en cada petición y el navegador no consulta la elevación.
- **Limpieza:** túneles desde `intersections[].classes` de Mapbox (la altura es la recta entre sus extremos) y pendiente máxima del 15 % entre puntos del perfil denso. Mapbox no marca puentes; la pendiente máxima recorta el hueco del valle.
- **Sin elevación:** error tipado `ELEVATION_UNAVAILABLE`, con `dataQuality` en la respuesta y un aviso claro, sin bloquear el plan.


## Medición con datos reales (2026-09-26, O4)
Detalle en `docs/arquitectura-ev/mediciones/elevacion-2026-09-26.md` (Bucaramanga → Bogotá, 421,6 km).
- **Tileset:** `mapbox.terrain-rgb` responde con el token del proyecto. No se cambia.
- **Costo:** 49 teselas para la ruta nueva (~12 cada 100 km) en 1 s. La segunda vez fueron 0 teselas y 8 ms.
- **Mapbox frente a Open-Meteo:**
  - desnivel neto parecido (+1588 m frente a +1617 m);
  - subida acumulada del doble (9117 m frente a 4303 m);
  - energía +6,7 %.
  - Falta contrastar la subida con una referencia externa. Si sobra, se ajusta la histéresis o el suavizado de `ModelParameters.elevation.dense`.
- **Límites de ráfaga:** `open-meteo-adaptive` cayó al respaldo porque las 4 consultas en paralelo dispararon el 429 de Open-Meteo, y luego el de OpenTopoData (1 consulta/s). Corrección:
  - 2 lotes a la vez;
  - reintento con pausa (1 s y 2,5 s) ante 429;
  - OpenTopoData encadenado con 1,1 s entre consultas;
  - errores HTTP con la URL recortada a 140 caracteres.

## Prueba de Terrain-DEM v1 (2026-09-27)
El dueño del producto pidió comparar `mapbox.mapbox-terrain-dem-v1` con el tileset actual (`mapbox.terrain-rgb`).
- **Lo que dice la documentación de Mapbox:**
  - misma fórmula de altura que Terrain-RGB;
  - teselas de 514 px (512 más 1 px de borde por lado);
  - datos hasta zoom 14;
  - se sirve por `raster/v1` en WebP, que es la API de Mapbox GL JS, y no figura en la Raster Tiles API v4 que usamos hoy. Por eso no basta con cambiar el nombre del tileset: cambian la API, el formato y quizá la facturación.
- **Código:** la lectura de teselas ahora
  - descuenta el borde (`tileBorder`);
  - acepta otro decodificador (`TileDecoder`);
  - puede pedir teselas @2x de 512 px por la misma API v4.
  El comportamiento de producción no cambia.
- **`npm run elevation:dem`** compara, sobre Piedecuesta → Vélez por defecto:
  - por qué API responde Terrain-DEM v1 con el token del proyecto;
  - teselas (consultas facturables), resolución, desnivel, energía y diferencia de alturas;
  - también Terrain-RGB y Terrain-DEM a zoom 11 con teselas de 512 px: la misma resolución que hoy (~38 m/píxel) con unas la mitad de teselas.
  Se validó sin red con un Mapbox simulado. Falta la corrida real: el entorno de desarrollo no llega a api.mapbox.com.
- **Primera corrida real (Villavicencio → Puerto López, `mediciones/terreno-dem-2026-09-27.md`):**
  - la Raster Tiles API v4 **sí** sirve Terrain-DEM v1 con el token del proyecto (PNG de 256 px), así que se factura igual que hoy. `raster/v1` responde 401;
  - a zoom 12, las alturas son idénticas a las de Terrain-RGB (Δh = 0), con las mismas 9 teselas: cambiar de tileset no cambia costo ni resultado;
  - zoom 11 con @2x pide 4 teselas en vez de 9, con la misma resolución, alturas a ≤ 1,3 m y la misma energía. Esa es la palanca de costo.
  - Falta confirmarlo en montaña (Piedecuesta → Vélez) antes de cambiar `ModelParameters.elevation.terrain`.

