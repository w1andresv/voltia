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
- **Decidido (2026-09-26):** cada parada cuesta 5 minutos fijos (`ModelParameters.charging.connectionOverheadMin`: estacionar, abrir la app, conectar, desconectar y salir), marcado `estimated` hasta calibrarlo. El dueño del producto prefiere menos paradas: con 0 min, "más rápida" partía una parada en dos para ganar 1 minuto; con 5 min ya no. Aplica a los dos planificadores; la ficha "10→80 %" del panel de batería no lo suma.
- El planificador actual se retira en F9.

## Decisión del dueño del producto (2026-09-26, D2 y D11)
- **D2:** `PLANNER_ENGINE=v2` después de 1–2 semanas en `shadow` en producción, si `[plan-trip:shadow]` no muestra diferencias sin explicar.
- **D11:** la espera en estación ocupada se mantiene en 15 min (`estimated`) hasta tener estado por conector (detalle de Blaze).

## Selector v1/v2 (2026-09-26)
Además de la variable del servidor, los correos en `ENGINE_PREVIEW_EMAILS` (por defecto el del dueño del producto) ven en el planificador un selector **v1 | v2**. v2 activa juntos el planificador y la energía v2 para sus planificaciones. El servidor verifica el correo; para los demás usuarios la elección se ignora y manda `PLANNER_ENGINE` / `ENERGY_ENGINE`.

Desde 2026-09-27 no hay selector: el motor lo define la URL del planificador (`/v1` o `/v2`), ver ADR 0012.

## Extra en carga rápida (2026-09-27, decisión del dueño del producto)
- **Regla:** en una estación de carga rápida (DC), el planificador v2 carga **10 puntos más de lo que pide el tramo siguiente**.
  - Así se aprovecha la velocidad y se evitan paradas largas en carga lenta.
  - El extra no pasa del 90 %, porque del 90 al 100 % la carga se vuelve lenta, ni de la carga máxima de viaje del vehículo (`maxSocTravel`, 80 % por defecto, editable hasta 100 %).
  - Si lo necesario ya pasa del 90 %, se carga solo lo necesario.
- **Implementación:** restricción de la programación dinámica (`planCharging`, `PlannerInput.fastChargeBuffer`, `PlannerNode.fast`). El tramo que sale de una estación rápida debe terminar con 10 puntos de más sobre el piso y la reserva, salvo que se salga con el tope (90 % o la carga máxima).
  - Un plan viable sin la regla sigue siéndolo: salir con el tope siempre cumple.
  - El óptimo se busca con la regla incluida, así que la carga extra se arrastra a las paradas siguientes.
  - Valores en `ModelParameters.planner.fastChargeBuffer`.
- **Interfaz:** cada parada muestra el extra (`ChargeStop.fastChargeExtraPct`).
- **Efecto en la caracterización:** la parada DC de 60 kW sale con 67 % en vez de 57 % (+5 min) y el viaje llega con 25 % en vez de 15 %.
- **El planificador v1 no cambia:** es la referencia de la comparación en sombra y ya carga de más en DC con sus propias reglas (8–12 puntos sobre la llegada).
- **Solo antes de otra parada (2026-09-29):** el extra se exige en los tramos que terminan en otra estación; al destino solo se pide la reserva. En el último tramo no hay una parada lenta que evitar, así que esos puntos eran minutos de carga sin beneficio (Bucaramanga → Bogotá llegaba con 26 % habiendo pedido 10 %). La parada intermedia sigue llegando a la siguiente con 10 puntos sobre el piso. Ya no aplica la línea "el viaje llega con 25 % en vez de 15 %" de arriba.
- **Topes (confirmado el mismo día):** el extra respeta siempre la carga máxima de viaje del vehículo; no se sube por encima de ella. Si el usuario pone ese tope sobre el 85 % (p. ej. 100 %), el editor de vehículo y el panel de batería le avisan que, por lo general, el último 10–15 % hasta el 100 % tarda más. Una parada que carga sobre el 85 % lo dice también (`src/lib/charge-notes.ts`).
