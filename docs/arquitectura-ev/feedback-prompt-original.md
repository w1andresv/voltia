# Feedback sobre el prompt original "Arquitectura definitiva — EV Route Planning Engine"

Revisión de la especificación original, antes de contrastarla con el código de Voltia. La versión corregida está en `prompt_ev_route_engine_v2.md`.

## Lo que está bien

- Separación de responsabilidades clara, con listas de "no debe hacer" por engine.
- Prohíbe atajos como `sport = consumo × 1.20` y usar potencia o torque como multiplicadores de consumo.
- Exige la fuente de cada dato del vehículo y distingue fabricante, fuente externa, calculado, estimado y configurable.
- La física base es correcta (aerodinámica, rodadura, pendiente, aceleración, auxiliares, regeneración).
- La carga antes de salir y la curva de carga están contempladas.
- Una sola fuente de verdad para las gráficas.

## Críticos (dan resultados erróneos o bloquean la implementación)

1. **El flujo en línea recta no alcanza.** Al añadir una parada la ruta cambia (desvío hasta la estación) y hay que recalcular energía y batería sobre la ruta nueva. Tampoco hay un componente que coordine los engines. Propuesta: un orquestador con dos pasadas (planificar sobre la ruta base y verificar sobre la ruta real con desvíos).
2. **Nadie ubica las estaciones sobre la ruta.** El planificador necesita el kilómetro de cada estación a lo largo de la ruta y el desvío. Se añade un paso que solo filtra y proyecta el listado existente (no es descubrimiento).
3. **La regeneración choca con el límite de la batería.** El Energy Engine no conoce el SOC, así que no puede saber que al bajar con la batería al 100 % no se recupera nada. El recorte debe hacerlo el SOC Engine.
4. **Los auxiliares solo se suman con potencia positiva (§4.6).** El aire acondicionado sigue consumiendo en bajada; así se subestima el consumo en montaña.
5. **El perfil final de batería no incluye las cargas.** El SOC Engine tiene que aceptar eventos de carga; si no, la gráfica y el SOC en destino no reflejan el plan.
6. **Faltan datos para la compatibilidad.** El vehículo no declara conectores, AC/DC ni potencia máxima de carga. Los adaptadores son del usuario, no del vehículo, y no está claro en qué sentido se lee "CCS2 → CCS1".
7. **El caso de prueba todavía no es un test.**
   - No identifica el vehículo, así que no hay de dónde sacar Cd, área frontal ni Crr.
   - No aclara si los 47,1 kWh son capacidad total o útil (el ejemplo anterior usa 44 kWh útiles).
   - Faltan SOC inicial, temperatura, listado fijo de estaciones y resultados esperados con tolerancias.
8. **El ejemplo de la sección 8 se contradice.** Si se llega al destino con 12 % y la reserva es 10 %, no hace falta ninguna parada, ni siquiera en C.
9. **El determinismo no es posible con Mapbox en vivo** (el tráfico cambia). Hay que guardar las respuestas de los proveedores y que los tests no usen red.

## Importantes (quedan abiertos a interpretación)

- **El perfil de velocidad no tiene algoritmo.** En montaña las curvas limitan más que las señales; la "mayor variabilidad" del modo sport tiene que ser determinística.
- **Los datos de elevación sin limpiar inflan la energía de subida.**
  - Hay ruido, y en puentes y túneles el modelo devuelve el fondo del valle o la cima.
  - Copernicus mide superficie (árboles y edificios incluidos), no terreno.
  - Hace falta suavizar y fijar una pendiente máxima.
- **Las condiciones ambientales aparecen en el objetivo pero no en ninguna interfaz.** Entre 500 m y 2.000 m de altitud la densidad del aire cae cerca de un 17 % (a igual temperatura), y eso cambia la resistencia aerodinámica.
- **La optimización no está definida.**
  - "Seguridad" no tiene un valor medible.
  - Elegir siempre la estación más lejana alcanzable no garantiza la mejor solución cuando la cantidad a cargar varía.
  - Propuesta: reglas en orden de prioridad, sin pesos arbitrarios.
- **La carga antes de salir** debe calcularse como "el SOC inicial mínimo con el que existe un plan viable", no a partir de una "primera estación" fija, y redondearse hacia arriba al mostrarla.
- Faltan por definir `Route`, `ChargingStation`, `ChargingStop`, `EnergyProfile` y el adaptador del listado existente de estaciones.
- `reason?: string` debería ser una lista de códigos, y un fallo de datos no debe reportarse como "ruta no viable".
- En el resultado, `durationMinutes` es ambiguo: no queda claro si incluye cargas y desvíos.

## Menores de física

- Falta la masa rotacional equivalente al calcular la aceleración.
- La aceleración debe salir de la diferencia de velocidades al cuadrado para que la energía cinética cuadre.
- El proveedor de elevación no debería calcular la pendiente; eso le toca al engine.
- Agrupar datos para las gráficas también es un cálculo: debe hacerse en el dominio y repartir cada segmento entre las ventanas que cruza.

## Cómo quedó en el prompt v2

Todo lo anterior está incorporado en `prompt_ev_route_engine_v2.md`, más fases de implementación con criterios de cierre y tests con resultados calculables a mano. Los datos que solo el usuario puede dar quedaron como **[COMPLETAR]**. Al revisar el repo se encontró que el vehículo del caso de prueba es el **MG S5 EV Deluxe** del catálogo (47,1 kWh útiles, 49 brutos, 1672 kg), lo que resuelve la mayoría de esos campos (ver `02-plan-arquitectura-modular.md`, sección 7).
