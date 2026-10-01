# 0019. Planificador v2: el margen de seguridad es flexible

- Estado: aceptada
- Fecha: 2026-10-01

## Contexto
Desde ADR-0016/0017 el margen de seguridad del viaje es la única reserva: el v2 no deja que la batería baje de él en ningún punto de la ruta ni al llegar. Es una regla dura, y a veces cuesta caro por muy poco. En una ruta plana de 300 km con una estación DC a mitad de camino y margen normal (15 %), saliendo con 100 %:
- respetando el margen se llega con unos 12 % sin cargar, así que el plan pide una parada (215 min en total, llega con 34 % por la sesión mínima de ADR-0018);
- bajando 3 puntos del margen no hace falta parar: 200 min y llega con 12 %.

El dueño del producto decidió que el margen "no es estricto, puede variar unos puntos, siempre y cuando no quede sin batería".

## Decisión
El margen sigue siendo el objetivo; por debajo de él hay un piso duro, el **margen flexible**: el margen menos `planner.marginFlex.belowPct` (3 puntos), sin bajar de `planner.belowSafetyFloorPct` (5 %). Con margen 15 % el piso es 12 %; con un margen de 4 %, el piso es el mismo 4 %. Ese piso vale en todo punto de la ruta y al destino (`TripConfiguration.minimumSocPercent` y `destinationReserveSocPercent`, ver `flexibleReserveSocPct`).

El v2 planifica dos veces:
1. **Estricto**: como antes, sin bajar del margen (o hasta 5 % en ruta con "permitir bajar del margen", ADR-0017).
2. **Flexible**: con el piso flexible. En la programación dinámica cada punto bajo el margen, en el punto más bajo de cada tramo y al llegar, cuesta `marginFlex.penaltyMinPerPct` (4 min): entre planes parecidos gana el que baja menos.

Se usa el flexible solo si es claramente mejor (`flexibleGain` en `stops-v2.ts`), en este orden:
- respetando el margen no hay plan viable (`"only-way"`);
- evita cargar antes de salir (`"no-precharge"`); pedir unos puntos menos de esa carga no cuenta;
- tiene menos paradas (`"fewer-stops"`);
- con las mismas paradas, ahorra al menos `marginFlex.minSavingMin` (10 min) de carga y desvío (`"faster"`).

En **"más segura"** solo se baja del margen si respetándolo no hay plan. Si el plan estricto ya llega sin paradas ni carga previa, ni se busca el flexible.

El plan lo dice: `RoutePlan.belowMargin` trae el SOC más bajo, cuántos puntos queda bajo el margen, el piso y el motivo (sin motivo, es porque el usuario permitió bajar del margen en ruta). Cada parada cuyo tramo siguiente baja del margen trae `belowMarginNext`.

## Consecuencias
- Se evitan paradas y cargas previas que solo existían para no bajar 1–3 puntos del margen. Nunca se baja del piso flexible, y la verificación final de la curva (§5.9) se mantiene contra ese piso.
- No se baja del margen para ahorrar un par de minutos de carga: con las mismas paradas el plan es el estricto, salvo que el ahorro llegue a 10 min.
- La interfaz avisa con el texto de `belowMarginText`: cuánto baja, dónde, qué se gana y el piso. La "Llegada" bajo el margen se muestra en advertencia, no en peligro, si el plan es viable.
- Sin cambios: planificador v1, consumo, estaciones, adaptadores y las reglas de ADR-0018. El simulador de las guías sigue con el margen estricto: es una explicación simplificada.
- Con `belowPct = 0` el v2 vuelve a ser el de antes (así lo usan las pruebas de ADR-0017 y ADR-0018 como control).
