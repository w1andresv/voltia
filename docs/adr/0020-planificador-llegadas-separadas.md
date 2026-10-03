# 0020. Planificador de cargas: llegadas separadas de los niveles de salida, y plazos

- Estado: aceptada
- Fecha: 2026-10-03
- Fase: M1

## Contexto
El planificador v2 (programación dinámica sobre estación × SOC de salida) escribía, por cada llegada a una estación, los ~90 niveles de salida posibles: estaciones² × niveles². Con muchas estaciones en el corredor el costo se disparaba, y el navegador lo repite cada vez que se mueve un control. Medido en una ruta sintética de montaña de 421 km (Node 22, ms por ruta, mismo escenario antes y después, `npm run bench:planner`):

| Estaciones | Repartidas, antes | Repartidas, ahora | Agrupadas cerca del destino, antes | Agrupadas, ahora |
| --- | --- | --- | --- | --- |
| 20 | 93 | 21 | 39 | 16 |
| 40 | 60 | 26 | 73 | 19 |
| 80 | 544 | 112 | 955 | 117 |
| 120 | 1.278 | 209 | 1.754 | 187 |

El planificador v1 tarda 2–9 ms en los mismos casos.

## Decisión
1. **Llegada y carga por separado.** Al alcanzar una estación solo se guarda la llegada (SOC al llegar y costo acumulado) en la cubeta de su primer nivel de salida posible. Al procesar la estación, los niveles de salida se arman con la mejor llegada entre las que valen para ese nivel (las de ese primer nivel o menos). Es exacto: los minutos de salir con `k` son `chargeAt(k) − chargeAt(llegada) + conexión`, y el segundo sumando es igual para todas las llegadas, así que su orden no depende de `k`. A igual costo gana la llegada más antigua, como en el planificador anterior. Para que valga, `PlannerNode` pasa de `chargeMinutes(desde, hasta)` a `chargeAt(soc)` (acumulada) más `connectionMin`.
2. **Una corrida por combinación.** Estaciones, tablas de carga y SOC gastado se arman una sola vez para la pasada estricta y la flexible, y cada (SOC inicial, tope estirado) se resuelve una sola vez dentro de una planificación (la búsqueda de carga previa, el tope estirado y la sugerencia de carga previa repiten entradas).
3. **Comprobación.** `planner.reference.ts` es una copia congelada del planificador anterior; `planner.equivalence.test.ts` compara 400 casos aleatorios (las cinco estrategias, margen flexible, sesión mínima, tope estirado, margen de carga rápida, atajo lineal) y la carga previa mínima: misma viabilidad, mismo costo óptimo, mismas estaciones alcanzables y el mismo plan.
4. **Observabilidad.** `PlannerRunStats` (estaciones, corridas, expansiones, llegadas, etiquetas) llega a `[plan-trip]` junto con los milisegundos por fase. `planner.rendimiento.test.ts` fija un presupuesto en contadores, que no dependen de la máquina.
5. **Plazos y memoria.**
   - La pasada 2 al planificar tiene un plazo (`planner.verifyBudgetMs`, 8 s, como al compartir): si se agota, se responde con la pasada 1 marcada `failed`.
   - La sombra corre después de responder (`after()` de Next).
   - El perfil de energía de una ruta se memoriza por vehículo, clima y las condiciones que cambian la física; mover el SOC, el margen o la estrategia no la repite.
   - La memoria del proceso de los proveedores es un LRU de 200 entradas.
   - Las rutas de Mapbox se guardan 6 h (antes 90 s): el perfil `driving` no usa tráfico en vivo.
   - El clima se pide en coordenadas redondeadas a 0,05°.

## Consecuencias
- Mismos resultados que antes, probado; solo cambia el tiempo. A 120 estaciones queda en ~0,2 s por ruta (meta de M1: 200 ms): al límite. El trabajo que queda es el número de pares (expansión, estación): ~1,6 M llamadas a `reach` por plan.
- Evaluado y no hecho:
  - **Agrupar estaciones equivalentes.** Solo se pueden descartar las estrictamente dominadas en el mismo punto de la ruta; en datos reales (operadores y potencias distintas) casi no hay, y el desempate entre idénticas arriesga cambiar el plan elegido. El escenario agrupado del banco es sintético.
  - **Límite de candidatos por ventana** (`planner.maxCandidatesPerWindow`): cambia resultados; no hizo falta para llegar a la meta.
  - **Web Worker en el navegador.** El store recalcula de forma síncrona en muchos sitios y sus pruebas dependen de eso; con el DP en ~20 ms para ≤ 40 estaciones y la memoria de energía, el beneficio no justifica hacerlo asíncrono sin poder verificarlo de punta a punta en un navegador real. Queda como pendiente en la guía 05.
  - **`unstable_cache` → `"use cache"`**: se hará cuando se toque esa capa (la guía de migración de Next 16 lo recomienda).
- Pendiente: medir en producción con los registros nuevos cuántas estaciones suele tener un corredor real; si casi nunca pasa de 40, el costo de M1 ya no es un riesgo.
