# 0026. Pérdidas de carga y una sola función de tiempo de carga

- Estado: aceptada (los valores, pendientes de confirmar por el dueño)
- Fecha: 2026-10-03
- Fase: M4

## Contexto
1. Los kWh que se pagan en el cargador son más que los que entran a la batería (5–12 %), y en AC la batería recibe menos que la potencia de la toma por el cargador a bordo. El planificador v2 ignoraba las pérdidas: tiempos algo cortos y ningún dato de lo que se paga (la base del costo del viaje).
2. Había dos cálculos del tiempo de carga: la tabla de la programación dinámica (`stops-v2`) y `chargeTimeMinutes` (opciones de cada parada, resumen de adaptadores). Integraban sobre mallas alineadas distinto y uno daba 0 min bajo 0,2 puntos: lo que se optimizaba y lo que se mostraba diferían unas décimas de minuto.

## Decisión
- `chargeTimeTable` (engine de carga) es la **única** función de tiempo del planificador v2: la programación dinámica, las opciones de cada parada, la carga lenta alternativa y el resumen de adaptadores (`adapterSummary` recibe los minutos del v2) salen de ella. `chargeTimeMinutes` queda para el planificador v1 y las fichas del vehículo.
- `charging.efficiency = { dc: 0.95, ac: 0.88 }` (estimado). La potencia que carga la batería es `min(pico × curva(SOC), potencia de la toma × eficiencia)`: la curva del vehículo ya es de la batería y no se frena de nuevo; lo que limita la estación (o el cargador a bordo en AC) llega `× eficiencia`.
- Lo que se paga: `energyFromGridKwh = energía a la batería ÷ eficiencia`, por parada y por opción. El itinerario lo muestra ("se pagan X kWh"); es la base de la funcionalidad "Costo del viaje". El plan lo dice en sus supuestos (`charging.efficiency`).
- Solo el planificador v2 (con `efficiency = 1` en ambos, sin pérdidas).

## Consecuencias
- La carga es más lenta con estaciones limitadas por la toma: AC tarda 1/0,88 más (+13,6 %) y DC limitada por la estación 1/0,95 (+5,3 %); una DC rápida con vehículo más lento que la estación no cambia.
- Caracterización del v2: 2 escenarios cambian en ≤ 1 punto de SOC o 1 min. En Bucaramanga → Bogotá la parada de Tunja ya no necesita la sesión mínima (la carga necesaria dura más de 10 min); la prueba cubre ese régimen y el de sin pérdidas.
- **Decisión pendiente del dueño:** 0,95 y 0,88 son valores de partida. Se calibran con cargas reales (kWh del cargador frente a SOC ganado), y hay que decidir si se aplican a la estimación de precios.
- No se programa la potencia compartida entre tomas de un gabinete (M4.3): Blaze no entrega ese dato; no se inventa.
