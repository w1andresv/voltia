# 0016. El margen de SOC se define solo en el viaje; el vehículo no tiene mínimo ni tope

- Estado: aceptada
- Fecha: 2026-09-30
- Reemplaza a: [0003](./0003-reserva-incluye-minimo-del-vehiculo.md)

## Contexto
El SOC de seguridad se configuraba en dos lugares: el "Margen de seguridad" del viaje y, en la ficha del vehículo, "SOC mín. viaje" (`minSocRecommended`) y "SOC máx. en ruta" (`maxSocTravel`). La reserva era `max(margen, minSocRecommended)` (ADR-0003), así que con el MG S5 (mínimo 15 %) el margen "Bajo" (10 %) no tenía efecto, y el usuario no veía por qué. El tope de carga en ruta dependía de un campo del vehículo que casi nadie tocaba (80 % en todo el catálogo).

## Decisión
- Reserva = margen de seguridad del viaje. Objetivo al destino = `max(arrivalSoc, reserva)`. La función sigue siendo `socFloors`, ahora solo con las condiciones del viaje.
- `minSocRecommended` y `maxSocTravel` salen de `VehicleSchema`, del catálogo (seed) y del editor del vehículo.
- El tope de carga en ruta es uno solo para todos los vehículos: `ModelParameters.planner.maxChargeTargetSocPct` (80 %), leído con `routeChargeCapPct`.

## Consecuencias
- Con margen "Bajo" o personalizado bajo 15 %, el plan puede llegar a los cargadores con menos batería que antes (la caracterización cambió por eso: MG S5 con margen 10 %).
- Los vehículos y viajes guardados con esos campos se siguen leyendo: Zod descarta las claves que ya no están en el esquema. Una edición de catálogo que solo cambiaba el mínimo o el tope deja de contar como edición.
- Un vehículo que necesite otro tope ya no puede declararlo. Si hace falta, se vuelve a agregar como parámetro del viaje, no del vehículo.
