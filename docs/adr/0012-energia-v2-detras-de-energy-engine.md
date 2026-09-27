# 0012. Energía v2 (física sin multiplicadores y perfil de velocidad) detrás de ENERGY_ENGINE

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F5

## Contexto
El modelo actual (`domain/energy.ts`) calcula la física con varios multiplicadores. La especificación (§5.3, §5.4) pide física por tramo sin multiplicadores, con el estilo representado por velocidades y aceleraciones. Los multiplicadores de hoy son:
- `CYCLE_OVERHEAD` 1,14;
- `STYLE_MULT`;
- `STYLE_SPEED_FACTOR`;
- el factor por temperatura sobre la tracción;
- la eficiencia y el tope de regeneración derivados de `motorKw`.

Cambiarlo cambia el consumo, así que va detrás del modo sombra, igual que el planificador (ADR-0007).

## Decisión
- **Variable:** `ENERGY_ENGINE = legacy | shadow | v2`, por defecto `legacy`, independiente de `PLANNER_ENGINE` para poder medir y activar cada uno por separado. En `shadow` se registra `[plan-trip:energy-shadow]`: energía, kWh/100 km, manejo (y el del proveedor), SOC de llegada y mínimo, y paradas por ruta. En desarrollo es una tabla y en producción JSON. El navegador recalcula con el mismo modelo (`geo.energyEngine`), y el snapshot lo guarda.
- **Perfil de velocidad** (`engines/speed`): malla de 100 m más el km de cada muestra, y velocidad típica del proveedor (o la fija del usuario).
  - Tope por curva `√(a_lat·R)`, con R medido con vecinos a ±100 m. La geometría disponible tiene hasta 420 puntos, así que en rutas largas subestima la curvatura.
  - Objetivo por modo sin pasar el límite legal (anotación `maxspeed` de Mapbox, que ahora se pide).
  - Pasadas de aceleración y frenado, con 0 km/h en origen y destino.
  - Parámetros por modo de la especificación. Para `sport` se usa +8 % sobre la típica, con tope en el límite legal, porque no hay dato de congestión.
  - El tiempo de manejo sale del perfil y se reporta junto al del proveedor, sin reescalarlo.
- **Física** (`engines/energy/physics.ts`): las fórmulas de §5.4 por tramo (aire con viento, rodadura, pendiente exacta `m·g·Δh`, aceleración con `m_eff`, g = 9,80665).
  - Tracción: energía en la rueda / eficiencia.
  - Regeneración: fracción de captura del modo × eficiencia de regeneración, con tope de potencia.
  - Auxiliares y aire acondicionado siempre, también en bajada.
  - Sin multiplicadores ni `motorKw`.
- **Parámetros del vehículo** (`vehicle-params.ts`), cada uno con su fuente. Lo que trae el vehículo se marca `configurable` (campos nuevos opcionales en el esquema); lo que falta sale de `ModelParameters.energy` como `estimated` y aparece en el plan (`energyAssumptions`) y en la tarjeta de estadísticas.
- **Consumo manual:** en vez de multiplicar el resultado, se escalan Cd·A y Crr para que en llano a 70 km/h dé el consumo del usuario (factor entre 0,5 y 2). La pendiente, la aceleración y la regeneración siguen siendo física.
- **El entorno se comparte con el modelo anterior** (`engines/energy/environment.ts`: temperatura por altitud, densidad del aire, viento y aire acondicionado), movido sin cambiar la aritmética.

## Consecuencias
- Con `legacy` nada cambia. La caracterización es idéntica salvo los campos nuevos (`energyEngine`, `speedLimitKmh`), verificado con la huella.
- En la ruta sintética de montaña el v2 da ~7 % menos energía que el actual, porque desaparece el 1,14 de "ciclo" y los multiplicadores. El tiempo de manejo queda a ±2 min del proveedor.
- Pendiente de calibrar con viajes reales: eficiencias, captura de regeneración y potencia auxiliar (todo `estimated`), y si hace falta un efecto de temperatura sobre la eficiencia (el v2 no lo tiene; el actual sumaba hasta +7 % a 10 °C).
- Pendiente: 0 km/h en los puntos intermedios del usuario y en las paradas de carga (la ruta base no trae los límites entre tramos), el desvío a una estación con la energía local del perfil (hoy usa el cálculo del modelo actual) y la tabla de velocidad por clase vial cuando no hay límite.
- F6 (quitar los multiplicadores del código) se hace cuando el modo sombra en producción muestre diferencias dentro de un rango aceptado.

## Decisiones del dueño del producto (2026-09-26)
- **D3:** no se fija un rango numérico de diferencia. El dueño decide cuándo activar la energía v2 con `ENERGY_ENGINE`, que se conserva hasta su visto bueno; F6 empieza solo cuando lo pida.
- **D4:** se agrega **ya** el efecto del frío: eficiencia del tren motriz en función de la temperatura, con puntos `estimated` parecidos al modelo actual (guía 05, §5.3.5).
- **D5:** `sport` = +8 % sobre la velocidad típica, con tope legal y de curva (lo implementado).
- **D8:** sin límite de Mapbox, tope por tipo de vía: primaria 90, secundaria 80, terciaria 60, local/urbana 50, sin pavimentar 40 km/h, `configurable` (guía 05, §5.3.4).

## Calibración (sesión D, 2026-09-26)
Contrato `TripObservation` y `compareObservation` en `domain/ev/contracts/calibration.ts` (especificación §9). Falta decidir cómo registra el usuario el viaje real (guía 05, D13).

## Sesión A (2026-09-26)
Se resolvieron los pendientes de este ADR:
- **Paradas:** 0 km/h en los puntos intermedios (`legBoundariesKm`).
- **Desvío:** consumo local ±2 km más el costo de parar y arrancar (`detourEnergyV2`; §5.8.1).
- **Tope por clase vial** cuando no hay límite (`defaultByRoadTier`, D8).
- **Frío:** factor de la tracción por temperatura (`temperatureFactor`, D4). En el lado frío es igual al modelo anterior; en calor es casi plano, porque el aire acondicionado ya suma el enfriamiento en los auxiliares.

Sigue pendiente la calibración con viajes reales.

## Selector v1/v2 (2026-09-26)
Además de la variable del servidor, los correos en `ENGINE_PREVIEW_EMAILS` (por defecto el del dueño del producto) ven en el planificador un selector **v1 | v2**. v2 activa juntos el planificador y la energía v2 para sus planificaciones. El servidor verifica el correo; para los demás usuarios la elección se ignora y manda `PLANNER_ENGINE` / `ENERGY_ENGINE`.

## Selector abierto a todos (2026-09-27)
Por pedido del dueño del producto, el selector v1/v2 queda visible para todos, invitados incluidos: `ENGINE_PREVIEW_EMAILS` vale `*` por defecto. Con una lista de correos se vuelve a limitar. El valor por defecto de los motores (`PLANNER_ENGINE`, `ENERGY_ENGINE`) no cambia: quien no toque el selector sigue con v1 hasta D3.

Desde 2026-09-27 cada motor tiene su ruta: `/` es el landing, `/v1` el planificador con el motor actual y `/v2` con el nuevo. La ruta fija el motor; el selector v1/v2 navega entre las dos y, si ya había una ruta calculada, se vuelve a planificar. `/planificar` redirige a la ruta del motor de `PLANNER_ENGINE` para no romper enlaces viejos.
