# 0023. Margen de energía: conectar `planning.energyMarginPercent`

- Estado: aceptada (decisión del dueño: conectarlo con 0 por defecto)
- Fecha: 2026-10-03
- Fase: M2

## Contexto
`ModelParameters.planning.energyMarginPercent` llegaba hasta `TripConfiguration` y nadie lo leía. Es la base natural de una banda de confianza ("llegas con 18 %, entre 12 y 23 %"), que el informe propone como funcionalidad.

## Decisión
Se conecta, con **0 por defecto** (ningún resultado cambia). `withEnergyMargin(samples, pct)` (engine de SOC) escala la energía bruta por `1 + pct/100` y deja la regeneración: lo que podría recuperarse no sube con un consumo mayor. El planificador v2 planifica con esas muestras (programación dinámica, `requiredStartSoc`, verificación final); la curva que ve el usuario es la nominal. El planificador v1 no lo usa.

## Consecuencias
- Con un margen mayor que 0 nunca hay menos paradas y el plan aguanta un gasto mayor sin pasar del piso (probado simulando el plan con el gasto aumentado).
- No hay control en la interfaz: es un parámetro del modelo. La banda de confianza lo usará.
- El desvío a la estación no se escala.
