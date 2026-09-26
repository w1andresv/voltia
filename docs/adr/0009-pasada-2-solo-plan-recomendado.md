# 0009. Pasada 2: solo el plan recomendado, solo con el planificador v2

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F8

## Contexto
La especificación (§4) pide una segunda pasada: pedir la ruta real que pasa por las paradas elegidas, recalcular sobre ella y replanificar hasta 3 veces. Sin convergencia, el plan pasa a no viable con `PLAN_VALIDATION_FAILED`. Cada iteración es una consulta más a Mapbox y otra de elevación (viabilidad, riesgo F8).

## Decisión
- `application/plan-trip/verify-plan.ts` hace la pasada 2 para **el plan recomendado** y solo si tiene paradas. Corre con `PLANNER_ENGINE=v2`; en `legacy` y `shadow` no se pide nada más al proveedor.
- En cada iteración: ruta por origen, puntos del usuario y paradas (en orden de km), y destino. Plan sobre esa ruta **solo con las estaciones elegidas**: si alcanza, queda `verified` (o `changed` si hubo que cambiar paradas en una iteración anterior). Si no alcanza, plan con todas las estaciones del corredor sobre la ruta real; si ni así es viable, ese es el resultado. Máximo `planner.maxVerifyIterations = 3` rutas.
- **Diferencia con la especificación:** si no converge o el proveedor falla, el plan **no** pasa a no viable. Queda el de la pasada 1 con `verification.status = "failed"` y la UI dice que los desvíos son estimados. Que no converja es un límite del método, no una prueba de que el viaje sea imposible; cuando la ruta real sí muestra que no alcanza, el resultado es no viable.
- El resultado queda en `RoutePlan.verification` (`status`, `iterations` y `baseDistanceKm`). La tarjeta de estadísticas lo muestra.
- Al cambiar condiciones en el navegador, los planes se recalculan sobre las rutas base (pasada 1) y pierden la verificación: correcto, porque las paradas pueden cambiar.

## Consecuencias
- Con `v2`, el plan recomendado usa la distancia, la energía y el tiempo reales de entrar a cada estación, en vez del desvío estimado (2 × distancia en línea recta).
- Costo: 1 a 3 consultas de rutas y de elevación por planificación con paradas.
- Pendiente: verificar también al guardar o compartir un viaje (necesita el snapshot guardado, ver F8 `PlanningSnapshot`), y medir en sombra cuántas veces cambia el plan antes de pasar a `v2`.

## Decisión del dueño del producto (2026-09-26, D6)
La pasada 2 se ejecuta también **al compartir** un viaje, no al guardarlo. El resultado verificado queda en el snapshot (`verifiedRoutes`) y el link público lo muestra (guía 05, §5.6.1).
