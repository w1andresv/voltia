# 0003. La reserva de SOC incluye el mínimo recomendado del vehículo

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F0 (corrige C8)

## Contexto
El panel de batería usaba `max(margen, minSocRecommended, arrivalSoc)`, pero el planificador usaba solo el margen de seguridad. Con el MG S5 (mínimo 15 %) y margen "bajo" (10 %), el panel avisaba con 15 % y el plan dejaba llegar a los cargadores con 10 %.

## Decisión
Reserva = `max(margen de seguridad, vehicle.minSocRecommended)`. Objetivo al destino = `max(arrivalSoc, reserva)`. Si el usuario edita `minSocRecommended`, vale su valor. La función única es `socFloors` (`src/domain/types.ts`), y la usan el planificador, el panel de batería y la barra del vehículo.

## Consecuencias
- Con el MG S5, la reserva efectiva nunca baja de 15 %.
- En F1 `socFloors` pasa a `TripConfiguration` (`minimumSocPercent`, `destinationReserveSocPercent`).
