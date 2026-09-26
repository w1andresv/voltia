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
  - Open-Meteo ahora pide en lotes de 100 puntos (hasta 4 a la vez).
- **Medición:** una línea `[elevation]` por planificación (fuente, puntos, ms, desnivel) y `npm run elevation:compare`, que corre las tres fuentes sobre la misma ruta y compara consultas, tiempo, desnivel, energía y SOC de llegada.
- El snapshot guarda la fuente usada (`open-meteo`, `open-meteo/adaptive`, `mapbox-terrain/mesh`).

## Consecuencias
- Cambiar de fuente es una variable; el dominio no sabe de dónde vienen las alturas. Blaze (ADR-0008) entraría como otro `ElevationProvider`.
- Con `open-meteo-adaptive` o `mapbox-terrain` cambian el desnivel y el consumo en montaña. Conviene probarlas con `PLANNER_ENGINE=shadow`, mirar el log y correr `elevation:compare` en rutas de montaña antes de elegir.
- Costo: `mapbox-terrain` cuenta como uso de teselas de Mapbox (revisar el plan contratado); la caché lo reduce con el uso. `open-meteo-adaptive` hace varias consultas por ruta; el uso gratuito de Open-Meteo es no comercial.
- Pendiente de F2b: limpieza de túneles y puentes, límite de pendiente y error tipado `ELEVATION_UNAVAILABLE`. El tileset `mapbox.terrain-rgb` se verifica al correr `elevation:compare` con un token real; si Mapbox pide `mapbox.mapbox-terrain-dem-v1`, se cambia en `ModelParameters.elevation.terrain.tileset`.
