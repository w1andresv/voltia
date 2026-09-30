# 0018. Planificador v2: paradas que valen la pena (sesión mínima y tope estirado)

- Estado: aceptada
- Fecha: 2026-09-30

## Contexto
El v2 podía proponer paradas para cargar 1–2 puntos (p. ej. margen 10 %, llega con 11 %, sale con 12 %). En un barrido de 1.382 paradas (rutas planas y de montaña, las cuatro estrategias, AC y DC de 50 y 150 kW), 21 cargaban menos de 3 puntos y **todas** por una de dos causas:
1. **No hay parada anterior** (el SOC de salida es fijo): AC a 100 km y DC a 260 km, sale con 85 %, en la AC llega con 55,7 % y sale con 57 % (1,2 puntos, 9,3 min).
2. **La parada anterior ya salió al tope de 80 %**: sale de DC270 con 80 % y en DC450 carga 2,4 puntos (7 min).

Ninguna era "voluntaria": la programación dinámica ya cobra 5 min fijos por parada. Son paradas necesarias con una carga que no justifica el costo de parar. Un umbral fijo en % ("ignorar cargas < 5 %") rompería viajes, y el mismo % no significa lo mismo con otra batería o con otro cargador.

## Decisión
Definiciones por parada:
- **Necesita**: SOC de salida mínimo para que la ruta sea viable (llegar a la siguiente sobre el piso, o al destino con el margen) menos el SOC de llegada. No incluye el extra de carga rápida.
- **Marginal**: cargar solo lo que necesita toma menos que la sesión mínima. Depende de los kWh, de la potencia y la curva del cargador, y de la capacidad de la batería.

Reglas, con la viabilidad y el margen siempre por delante (la programación dinámica revisa el piso en cada muestra y la reserva al destino, y la verificación final se mantiene):
1. **Sesión mínima** (`planner.minChargeSessionMin` = 10 min, sin contar los 5 min de conexión): dentro de la programación dinámica, las salidas posibles de una estación empiezan en el SOC que se alcanza cargando 10 min, o en el tope en ruta si queda más abajo. Salir con más batería nunca vuelve inviable un plan.
2. **Tope estirado** (`planner.stretchChargeSocPct` = 90 %): si el plan tiene una parada marginal, se vuelve a planificar dejando salir hasta 90 %. Ese plan se acepta **solo si tiene menos paradas**. El extra de carga rápida y la sesión mínima se siguen midiendo contra el tope normal (80 %).
   - También se usa si **no hay ningún plan** con el tope normal, ni cargando antes de salir: es la única forma de hacer el viaje. Hace falta para que la pasada 2 (ADR-0009) sea coherente: al verificar un plan que ya salía por encima del 80 % solo con sus estaciones, sin esta regla no habría plan, la verificación entraría en ciclo y quedaría "no verificado" aunque el plan funcione.
   - Cada parada dice el motivo: `aboveRouteCap` = `"fewer-stops"` o `"only-way"`.
3. **Carga antes de salir**: si la primera parada es marginal, se calcula con cuántos puntos más al salir el plan no la necesita (`RoutePlan.skipFirstStop`). Es una sugerencia: el plan sigue siendo válido con el SOC actual.

Cada parada dice por qué carga más que el mínimo: `sessionExtraPct` (sesión mínima), `fastChargeExtraPct` (carga rápida, ADR-0007) o `aboveRouteCap` (pasa del 80 %).

## Consecuencias
- No hay paradas de 1 %: o se evitan (tope estirado, sugerencia de carga previa) o cargan al menos 10 min.
- Bucaramanga → Bogotá (MG S5, 100 %, margen normal): antes Santana (42 → 76 %) y Tunja (36 → 45 %, ~4 min cargando); ahora solo Santana, saliendo con 84 %: una parada menos y 10 min menos en total.
- La última parada puede cargar más de lo necesario para llegar con el margen si lo necesario toma menos de 10 min: se llega al destino con algo más de batería.
- Sin cambios: estaciones verificadas y compatibles, adaptadores, consumo, margen de seguridad y planificador v1.
- El simulador de las guías sigue las mismas reglas.
