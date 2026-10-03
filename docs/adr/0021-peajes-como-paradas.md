# 0021. Peajes como paradas en el perfil de velocidad

- Estado: aceptada (el valor de segundos, pendiente de confirmar por el dueño)
- Fecha: 2026-10-03
- Fase: M2

## Contexto
En Colombia hay una caseta de peaje cada 50–80 km. Cada una es frenar hasta cero, esperar y volver a arrancar: energía cinética perdida, auxiliares del tiempo detenido y minutos. La energía v2 no las veía. Mapbox Directions marca los puntos de cobro en las intersecciones: `toll_collection: { type: "toll_booth" | "toll_gantry" }` (así lo documenta Mapbox).

## Decisión
- El adaptador lee `toll_collection` de cada intersección (`ProviderStep.intersections[].tollCollection`).
- `tollBoothsKm` (engine de ruta) toma solo las **casetas** (`toll_booth`): un pórtico electrónico no obliga a detenerse. El km se calcula como el de los túneles; los carriles de una misma plaza (a menos de 250 m) son una sola caseta. `RawRoute.tollBoothsKm` (opcional, también en el snapshot) las deja en el eje de las muestras, sin las pegadas al origen o al destino.
- `speedMesh` las agrega como puntos exactos con parada (`toll: true`), salvo las que quedan a menos de 150 m de otra parada: dos paradas pegadas dejarían un tramo con 0 km/h en los dos extremos, que la física no puede recorrer. El perfil frena hasta 0 y vuelve a acelerar (`limitingFactor: "toll"`).
- `speed.tollStopSeconds` (estimado, **30 s**) se suma al tiempo del perfil y a la energía de los auxiliares (base + aire acondicionado, + vía mojada si aplica) de la muestra de la caseta.
- El plan lo dice en sus supuestos (`speed.tollStopSeconds`, con el número de casetas).

## Consecuencias
- Solo con `ENERGY_ENGINE=v2`. Un snapshot viejo, o una ruta sin casetas, da exactamente la energía de antes.
- **Sin verificar con datos reales.** La sesión de desarrollo no tiene acceso a Mapbox: la ruta de las pruebas es sintética, con la forma documentada. Antes de confiar en el efecto hay que correr `npm run diagnose:route` con token en Bucaramanga → Bogotá y revisar que lleguen casetas con `toll_booth`. Si Mapbox no las trae en Colombia, el efecto es nulo (no rompe nada) y esta decisión no sirve.
- **Decisión pendiente del dueño:** los 30 s son un punto de partida (carril de efectivo y TAG promediados). Es un parámetro; se calibra con viajes con peaje.
- No se modela el peaje en dinero (eso es la funcionalidad "costo del viaje").
