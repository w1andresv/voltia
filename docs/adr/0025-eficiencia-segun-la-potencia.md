# 0025. Eficiencia del tren motriz según la potencia

- Estado: aceptada
- Fecha: 2026-10-03
- Fase: M3

## Contexto
La energía v2 usaba una eficiencia constante (0,90, batería → rueda). Un motor con inversor pierde eficiencia con poca carga (tráfico lento, bajadas suaves) y un poco con mucha; el consumo en ciudad y en arranques sale subestimado.

## Decisión
`energy.drivetrainEfficiencyCurve`: pares [P / P_ref, factor] (estimados). `P_ref` es la potencia en la rueda del crucero del vehículo en llano a `manualReferenceSpeedKmh` (70 km/h), con la densidad estándar y calculada con el vehículo ya ajustado al consumo manual si lo hay (`referenceCruisePowerKw`). El factor es 1 en `P_ref`; la eficiencia de un tramo con tracción es `drivetrainEfficiency × factor(P_rueda / P_ref)`, y el factor de temperatura se aplica después, como antes. Con la curva vacía, la eficiencia es constante.

Así `drivetrainEfficiency` sigue siendo la eficiencia de crucero (lo que carga el catálogo o el usuario, y lo que mueve la calibración), el ajuste al consumo manual no se mueve y los vehículos con dato propio no cambian de significado. `stopEnergyKwh` y `calibrateToManual` usan la eficiencia de referencia.

## Consecuencias
- Solo con `ENERGY_ENGINE=v2`. En la ruta sintética de la caracterización, la energía baja ~0,5 % (la carretera queda un poco por encima de `P_ref`); en tráfico lento sube más de 3 %.
- La curva es una forma típica, no un dato del vehículo: queda como `estimated` y se calibra con viajes (`TripObservation`); la perilla de calibración sigue moviendo el nivel (`drivetrainEfficiency`), no la forma.
- La energía regenerada no cambia.
