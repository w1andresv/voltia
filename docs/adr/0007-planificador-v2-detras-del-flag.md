# 0007. El planificador v2 entra detrás de PLANNER_ENGINE

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F7

## Contexto
F7 reemplaza la selección de paradas por puntaje (D6) por programación dinámica con costo lexicográfico, y agrega la viabilidad con códigos (D9). Cambia qué estaciones propone la app y cuánto carga. En la caracterización sintética, por ejemplo:
- rutas que hoy salen "no viables" pasan a "viable cargando antes de salir", porque la carga previa se busca para todo el plan y no solo para llegar a la primera estación;
- carga lo justo para llegar con la reserva, en vez de sumar puntos fijos;
- en "más rápida" puede partir una parada en dos si ahorra tiempo, porque hoy una parada no cuesta minutos fijos (`connectionOverheadMin = 0`).

## Decisión
- El planificador v2 vive en `engines/charging/planner.ts` (programación dinámica pura, con el recorrido del SOC y los tiempos de carga inyectados) y `engines/feasibility/engine.ts`. `buildPlan` lo usa con `engine: "v2"`.
- `PLANNER_ENGINE` decide: `legacy` (por defecto) responde con el actual; `shadow` calcula ambos, responde con el actual y registra las diferencias en `[plan-trip:shadow]`; `v2` responde con el nuevo. El navegador recalcula con el mismo motor que usó el servidor (`geo.plannerEngine`).
- Sin tope fijo de 7 paradas: la programación dinámica termina sola.
- Las estaciones `offline` se excluyen; las `occupied` suman `occupiedWaitMin` (15 min, estimado).

## Consecuencias
- Nada cambia para los usuarios hasta poner `PLANNER_ENGINE=shadow` (para medir) o `v2`.
- **Pendiente de decidir antes de `v2`:** un tiempo fijo por parada (`ModelParameters.charging.connectionOverheadMin`, hoy 0). Con 0, "más rápida" puede preferir dos paradas cortas a una larga por un minuto. Un valor de 3–5 min lo evita, pero también suma ese tiempo a los planes del motor actual.
- El planificador actual se retira en F9.
