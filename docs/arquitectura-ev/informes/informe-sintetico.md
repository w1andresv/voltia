# Informe del plan (ruta sintética)

Piedecuesta (sintético) → Vélez (sintético) · MG S5 EV Deluxe · Ruta A (Ruta 45A, Ruta 62)

Generado: 2026-09-01T12:00:00.000Z · modelo 0.1.0-legacy · planificador v2 · energía v2

## 1. Resumen

| Dato | Valor |
|---|---|
| Distancia | 129,1 km |
| Tiempo total | 2 h 22 min (manejo 2 h 22 min, carga 0 min) |
| Manejo según el mapa | 2 h 21 min |
| Energía neta | 19,1 kWh (14,8 kWh/100 km) |
| Energía bruta / regenerada | 21,9 / 2,8 kWh (recortada por SOC alto: 0,03 kWh) |
| SOC inicial → llegada (mínimo) | 80 % → 39,5 % (39,5 %) |
| Paradas | 0 |
| Viable | sí (FEASIBLE_NO_CHARGING) |
| Desnivel | ↑ 2.036 m · ↓ 2.037 m · -91–1.732 m |

## 2. Parámetros con fuente

| Parámetro | Valor | Fuente | Referencia / notas |
|---|---|---|---|
| Masa total | 1.852 kg | calculado | Peso del vehículo + pasajeros + equipaje. |
| Cd·A | 0,75 m² | configurable |  |
| Crr | 0,009 | configurable |  |
| Factor de inercia rotacional | 1,05 | estimado | Típico 1,03–1,08 (especificación §3.3). |
| Eficiencia batería → rueda | 0,9 | estimado | Batería → rueda; el modelo anterior daba 0,90–0,925 según motorKw. |
| Eficiencia rueda → batería | 0,8 | estimado | Rueda → batería. |
| Potencia máxima de regeneración | 60 kW | estimado | Sin dato del fabricante; el modelo anterior usaba 40 % de motorKw. |
| Consumo auxiliar base | 0,45 kW | estimado | Mismo valor que el modelo anterior. |
| Batería útil | 47,1 kWh | catálogo | |
| Modo de conducción (normal) | targetSpeedFactor: 1, maxAccelMs2: 1,2, maxDecelMs2: 1,5, maxLateralAccelMs2: 2 | estimado | sport: +8 % sobre la velocidad típica, tope en el límite legal (sin dato de congestión). |
| Regeneración (medium) | captureFraction: 0,7, maxPowerFraction: 0,8 | estimado | Calibrar con viajes reales (TripObservation). |
| Factor de tracción por temperatura (°C → factor) | 0 → 1,28; 5 → 1,16; 10 → 1,07; 15 → 1; 32 → 1; 38 → 1,03 | estimado | docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md §3.1 (D4) · Lado frío igual al modelo anterior (batería, llantas y tren fríos). En calor casi plano: el aire acondicionado ya suma el enfriamiento en los auxiliares. |
| Tope por clase vial sin límite legal | primary: 90, secondary: 80, tertiary: 60, local: 50, unpaved: 40 km/h | configurable | docs/arquitectura-ev/05-pendientes-y-guia-de-desarrollo.md §3.1 (D8) · Decisión del producto; confirmar contra la normativa colombiana vigente. |
| Minutos fijos por parada | 5 min | estimado | Estacionar, app, conectar, desconectar y salir. Decisión del producto; calibrar con paradas reales. |
| Espera en estación ocupada | 15 min | estimado | Sin datos de ocupación; calibrar. |
| Factor vial del desvío estimado | 1 | estimado | Línea recta ida y vuelta; se reemplaza con la matriz de rutas. |

## 3. Paradas

Sin paradas.

## 4. Series de las gráficas

### Consumo por ventana (2 km)

| Desde km | Hasta km | kWh | kWh/100 km |
|---|---|---|---|
| 0 | 2 | -0,01 | -0,4 |
| 2 | 4 | -0,12 | -6 |
| 4 | 6 | -0,11 | -5,3 |
| 6 | 8 | -0,09 | -4,5 |
| 8 | 10 | -0,07 | -3,5 |
| 10 | 12 | -0,05 | -2,4 |
| 12 | 14 | -0,02 | -1,1 |
| 14 | 16 | 0 | 0,2 |
| 16 | 18 | 0,03 | 1,7 |
| 18 | 20 | 0,07 | 3,7 |
| 20 | 22 | 0,14 | 7,1 |
| 22 | 24 | 0,21 | 10,5 |
| 24 | 26 | 0,28 | 14,1 |
| 26 | 28 | 0,35 | 17,5 |
| 28 | 30 | 0,42 | 21,2 |
| 30 | 32 | 0,49 | 24,4 |
| 32 | 34 | 0,56 | 27,8 |
| 34 | 36 | 0,62 | 30,8 |
| 36 | 38 | 0,67 | 33,7 |
| 38 | 40 | 0,72 | 36,1 |
| 40 | 42 | 0,77 | 38,4 |
| 42 | 44 | 0,8 | 40,1 |
| 44 | 46 | 0,83 | 41,5 |
| 46 | 48 | 0,85 | 42,5 |
| 48 | 50 | 0,86 | 43 |
| 50 | 52 | 0,86 | 43 |
| 52 | 54 | 0,85 | 42,6 |
| 54 | 56 | 0,83 | 41,7 |
| 56 | 58 | 0,81 | 40,3 |
| 58 | 60 | 0,77 | 38,6 |
| 60 | 62 | 0,73 | 36,3 |
| 62 | 64 | 0,67 | 33,7 |
| 64 | 66 | 0,61 | 30,6 |
| 66 | 68 | 0,55 | 27,4 |
| 68 | 70 | 0,47 | 23,7 |
| 70 | 72 | 0,4 | 20,1 |
| 72 | 74 | 0,32 | 16,1 |
| 74 | 76 | 0,25 | 12,3 |
| 76 | 78 | 0,16 | 8,2 |
| 78 | 80 | 0,09 | 4,7 |
| 80 | 82 | 0,05 | 2,3 |
| 82 | 84 | 0,01 | 0,6 |
| 84 | 86 | -0,02 | -1,1 |
| 86 | 88 | -0,05 | -2,4 |
| 88 | 90 | -0,07 | -3,6 |
| 90 | 92 | -0,09 | -4,5 |
| 92 | 94 | -0,1 | -5,1 |
| 94 | 96 | -0,11 | -5,4 |
| 96 | 98 | -0,11 | -5,5 |
| 98 | 100 | -0,1 | -5,2 |
| 100 | 102 | -0,09 | -4,7 |
| 102 | 104 | -0,08 | -3,8 |
| 104 | 106 | -0,05 | -2,6 |
| 106 | 108 | -0,03 | -1,3 |
| 108 | 110 | 0,01 | 0,3 |
| 110 | 112 | 0,04 | 2,1 |
| 112 | 114 | 0,11 | 5,4 |
| 114 | 116 | 0,18 | 9,2 |
| 116 | 118 | 0,27 | 13,4 |
| 118 | 120 | 0,34 | 17,2 |
| 120 | 122 | 0,43 | 21,3 |
| 122 | 124 | 0,5 | 24,8 |
| 124 | 126 | 0,57 | 28,4 |
| 126 | 128 | 0,63 | 31,3 |
| 128 | 129,1 | 0,26 | 24,1 |

### SOC contra distancia

Un punto por ventana y los dos de cada parada (llegada y salida).

| km | SOC % | |
|---|---|---|
| 0 | 80 |  |
| 2,4 | 80,1 |  |
| 4,8 | 80,4 |  |
| 7,2 | 80,6 |  |
| 9,6 | 80,8 |  |
| 12 | 80,9 |  |
| 14,4 | 81 |  |
| 16,8 | 81 |  |
| 19,2 | 80,8 |  |
| 21,6 | 80,5 |  |
| 24 | 80 |  |
| 26,4 | 79,3 |  |
| 28,8 | 78,3 |  |
| 31,2 | 77,2 |  |
| 33,6 | 75,8 |  |
| 36 | 74,2 |  |
| 38,4 | 72,5 |  |
| 40,8 | 70,6 |  |
| 43,2 | 68,6 |  |
| 45,6 | 66,5 |  |
| 48 | 64,4 |  |
| 50,4 | 62,2 |  |
| 52,8 | 60 |  |
| 55,2 | 57,8 |  |
| 57,6 | 55,8 |  |
| 60 | 53,8 |  |
| 62,4 | 52 |  |
| 64,8 | 50,3 |  |
| 67,2 | 48,8 |  |
| 69,6 | 47,5 |  |
| 72 | 46,5 |  |
| 74,4 | 45,7 |  |
| 76,8 | 45,1 |  |
| 79,2 | 44,8 |  |
| 81,6 | 44,7 |  |
| 84 | 44,6 |  |
| 86,4 | 44,7 |  |
| 88,8 | 44,8 |  |
| 91,2 | 45 |  |
| 93,6 | 45,3 |  |
| 96 | 45,6 |  |
| 98,4 | 45,8 |  |
| 100,8 | 46,1 |  |
| 103,2 | 46,3 |  |
| 105,6 | 46,5 |  |
| 108 | 46,5 |  |
| 110,4 | 46,5 |  |
| 112,8 | 46,4 |  |
| 115,2 | 46 |  |
| 117,6 | 45,4 |  |
| 120 | 44,5 |  |
| 122,4 | 43,4 |  |
| 124,8 | 42,1 |  |
| 127,2 | 40,6 |  |
| 129,1 | 39,5 |  |

## 5. Calidad de datos

| Dato | Valor |
|---|---|
| Rutas | mapbox |
| Elevación | mapbox-terrain/mesh |
| Clima | open-meteo |
| Electrolineras | dataset synthetic-1, 5 en el corredor |
| Elevación disponible | sí |
| Límite legal en la ruta | 91 % de las muestras |
| Clase vial en la ruta | 99 % de las muestras |

## 6. Avisos

Ninguno.

## 7. Supuestos estimados

Valores sin fuente del fabricante ni calibración, que conviene revisar o calibrar con viajes reales:

- Factor de inercia rotacional: 1,05
- Eficiencia batería → rueda: 0,9
- Eficiencia rueda → batería: 0,8
- Potencia máxima de regeneración: 60 kW
- Consumo auxiliar base: 0,45 kW
- Modos de conducción (velocidad y aceleraciones)
- Regeneración por modo
- Factor de tracción por temperatura
- Minutos fijos por parada
- Espera en estación ocupada
- Factor vial del desvío estimado
- Cd·A y Crr por carrocería

