# Cálculo de consumo de energía

> Este es el modelo **anterior** (`ENERGY_ENGINE=legacy`, el valor por defecto mientras no se active la v2). El modelo v2, física sin multiplicadores, está en [calculo-consumo-energia-v2.md](./calculo-consumo-energia-v2.md). En F9 este documento se reemplaza por ese.

La ruta no usa los kWh/100 km de ficha como consumo del viaje. Cada tramo llama a `segmentEnergyKwh` en `src/domain/energy.ts`. Esa función devuelve los kWh netos que salen de la batería en ese tramo. El planificador la usa para el estado de carga, las paradas y la gráfica.

Hay dos motores. Si el vehículo tiene consumo manual (`consumptionManual` y `consumptionKwhPer100km` mayor que 0), entra `manualSlice`. Si no, entra `physicsSlice`. Los dos devuelven la misma forma.

## Entrada

```ts
segmentEnergyKwh(
  distanceKm,   // km del tramo
  elevDeltaM,   // metros de desnivel del tramo (subida positiva, bajada negativa)
  speedKmh,     // velocidad del tramo, km/h
  ctx,          // vehículo, condiciones del viaje, clima y altitud del origen
  geo,          // opcional: altitud media y rumbo del tramo
): number       // kWh netos
```

`ctx` es un `EnergyContext`:

| Campo | Qué aporta al cálculo |
|---|---|
| `vehicle.weightKg` | Masa en vacío (ya incluye la batería). Entra en rodadura y gravedad. |
| `vehicle.batteryKwh` | Convierte kWh en % de batería. Ya no suma un sobrecosto de pack: el peso de la batería está en `weightKg`. |
| `vehicle.motorKw` | Estima eficiencia del tren y tope de regeneración. |
| `vehicle.bodyType` | Carrocería (`sedan`, `suv_compact`, `suv_large`). Elige CdA y Crr por defecto. Sin dato, `suv_compact`. |
| `vehicle.dragAreaM2`, `vehicle.rollingResistance` | CdA y Crr propios del vehículo. Si están, reemplazan los de la carrocería. |
| `vehicle.consumptionKwhPer100km` | Solo si el consumo es manual. Es la base de kWh por km. |
| `vehicle.consumptionManual` | Elige el motor: manual o físico. |
| `vehicle.rangeKm` | No entra en el consumo del tramo. Solo sirve para el dato WLTP de referencia (`batería / autonomía × 100`). |
| `conditions.passengers` | Cada pasajero suma 75 kg. El conductor (75 kg) va siempre. |
| `conditions.luggageKg` | Suma kilos a la masa. |
| `conditions.drivingStyle` | `efficient`, `normal` o `sport`. Cambia la forma de acelerar y, aguas arriba, la velocidad. |
| `conditions.ac` | Clima: `off`, `eco`, `normal`, `max`. |
| `conditions.temperatureC` | Temperatura del viaje, medida en el origen. Si es null, se usa la del clima, y si tampoco hay, 20 °C. |
| `conditions.regenLevel` | Regeneración: `low` (baja), `medium` (media, por defecto) o `high` (alta). |
| `conditions.avgSpeedKmh` | No entra aquí. El planificador ya reescribió `speedKmh` de las muestras si el usuario fijó una velocidad. |
| `weather.temperatureC` | Respaldo de temperatura, medida a la altura de la celda del pronóstico (`weather.elevationM`). |
| `weather.windKmh`, `weather.windDirDeg` | Viento y de dónde viene. Se proyecta sobre el rumbo del tramo: de frente suma, de cola resta. |
| `originAltitudeM` | Altitud del origen. Es la altura a la que vale la temperatura que escribió el usuario. `annotateEnergy` la toma de la primera muestra. |

`geo` es un `SegmentGeo`, con los dos campos opcionales:

| Campo | Qué aporta |
|---|---|
| `altitudeM` | Altitud media del tramo. Cambia la densidad del aire y la temperatura. |
| `headingDeg` | Rumbo del tramo (0 = norte, 90 = este). Orienta el viento. |

La masa del viaje es:

```text
masa = weightKg + 75 + pasajeros × 75 + equipaje
```

## Salida

`segmentEnergyKwh` devuelve un número: kWh netos del tramo.

Por dentro, `segmentEnergyBreakdown` devuelve tres números. El neto es el que resta batería.

| Campo | Significado |
|---|---|
| `grossKwh` | Energía que pide el tramo: tracción más auxiliares. En bajada la tracción es 0 y solo quedan los auxiliares. |
| `regenKwh` | Energía que vuelve a la batería en bajada. |
| `netKwh` | `grossKwh − regenKwh`. Es la salida pública. **Puede ser negativo** en una bajada fuerte: la batería gana carga. |

Si `distanceKm` es 0 o negativo, los tres valores son 0.

## De cuántos kilómetros es cada tramo

No hay un largo fijo. Mapbox y OSRM arman las muestras en `buildSamples` (`src/infrastructure/providers/routing.osrm.ts`). El paso es:

```text
everyKm = max(0,8 km, distancia de la ruta / 220)
```

Cada tramo de consumo es la distancia entre dos muestras seguidas. Casi todos miden `everyKm`. El primero no gasta: la muestra del kilómetro 0 solo marca la salida. El último mide entre 0,4 y 1,4 veces `everyKm`, porque el bucle deja de insertar puntos cuando falta menos de `0,4 × everyKm` para el final y cierra con el destino.

| Distancia de la ruta | Paso (`everyKm`) | Tramos de ese largo |
|---|---|---|
| Hasta 176 km | 0,8 km | Casi todos. 176 / 220 = 0,8. |
| 220 km | 1,0 km | Casi todos. |
| 440 km | 2,0 km | Casi todos. |
| 700 km | 3,2 km | Casi todos. 700 / 220 ≈ 3,18. |

En una ruta de 212 km el paso es `max(0,8, 212/220)` = **0,96 km**. Hay unas 220 muestras y unos 219 tramos con consumo.

### Velocidad de cada tramo

Mapbox y OSRM se piden con `annotations=distance,duration`: metros y segundos entre cada par de puntos de la geometría. `speedProfile` los acumula y `applySegmentSpeeds` le da a cada muestra la velocidad del motor entre la muestra anterior y ella:

```text
velocidad del tramo = km del tramo / horas que el motor le asigna a ese tramo
```

Se recorta entre 8 y 130 km/h. Si no hay anotaciones, se usan los pasos de Mapbox (`steps=true`). Si tampoco hay, todas las muestras llevan la velocidad media de la ruta (distancia / duración, entre 28 y 125 km/h), como antes.

Así, un tramo urbano o de curvas lleva su velocidad baja y uno de autopista la alta. Como el aire crece con v², usar la media subestimaba el consumo en autopista.

### Elevación

`applyElevation` (`src/infrastructure/providers/elevation.openmeteo.ts`) pide la elevación de 96 puntos de la ruta (Open-Meteo y, si falla, OpenTopoData). Las demás muestras se interpolan en línea entre esos puntos y la serie se suaviza con una media móvil de 5 muestras. Si no hay elevación, todas las muestras quedan en 0 m y el plan avisa que el consumo puede estar subestimado en montaña.

## Cómo se recorre la ruta

`annotateEnergy` parte las muestras de la ruta. La primera muestra no gasta nada y su altitud queda como la del origen. De cada muestra a la siguiente:

1. Distancia = diferencia de `km`.
2. Desnivel = diferencia de `elevM`.
3. Velocidad = `speedKmh` de la muestra de llegada.
4. Altitud del tramo = promedio de las dos `elevM`. Rumbo = de la muestra anterior a la de llegada.
5. Se llama a `segmentEnergyBreakdown`. No depende del estado de carga: la regeneración que devuelve es la **potencial**.
6. Se acumulan los kWh netos.

Cada muestra queda con `energyKwh` (neto del tramo con la regeneración potencial), `energyGrossKwh`, `energyRegenKwh` (potencial), `cumulativeKwh` y `avgKwhPer100`. Es el perfil de energía de la ruta y sirve para cualquier SOC de salida.

El estado de carga lo calcula el SOCEngine (`src/domain/ev/engines/soc/simulate.ts`):

- `legSoc` recorre un tramo desde un SOC de salida y da el SOC de llegada y el más bajo del tramo. Es lo que el plan usa para saber si llegas a un cargador o al destino sin bajar de la reserva.
- `requiredStartSoc` da el menor SOC de salida para llegar con un objetivo y no bajar de un piso en ningún punto.
- `simulateSoc` arma la curva del plan con las cargas y los desvíos como eventos. No recorta el SOC en 0, para poder medir cuánto falta.

En cada tramo, la batería acepta una fracción de la regeneración potencial según el SOC con que empieza el tramo (ver "Regeneración").

Antes de anotar, el planificador ajusta la velocidad de las muestras:

- Si el usuario fijó velocidad media, todas las muestras van a esa velocidad.
- Si no, se multiplica la velocidad de cada tramo por el estilo: eficiente × 0,93, normal × 1, deportivo × 1,06.

Ese cambio de velocidad entra en el tiempo (auxiliares y clima) y en la resistencia del aire.

## Temperatura y aire en cada tramo

### Temperatura

La temperatura cambia con la altura, 6,5 °C por cada 1000 m (gradiente estándar):

```text
T(tramo) = T(referencia) − 6,5 × (altitud del tramo − altitud de referencia) / 1000
```

- Si el usuario escribió la temperatura, la referencia es el origen.
- Si viene del clima, la referencia es la altura de la celda del pronóstico (`weather.elevationM`, que da Open-Meteo). El pronóstico se pide en la mitad de la ruta.
- Si falta la altura de referencia, no se corrige.

Con esto, una ruta que sale del Magdalena Medio a 32 °C y sube al páramo llega con el clima y la batería de la altura, no con los 32 °C de la salida.

### Densidad del aire

La densidad depende de la temperatura y de la presión, y la presión baja con la altitud:

```text
presión = 101 325 × (1 − 2,25577e-5 × altitud)^5,25588    Pa
ρ       = presión / (287,05 × (273,15 + °C))                kg/m³
```

A nivel del mar y 15 °C da 1,225 kg/m³. En Bogotá (2600 m) queda cerca de 0,9: unos 25 % menos de arrastre que a nivel del mar.

### Viento

El pronóstico da el viento a 10 m de altura. A la altura del carro se toma el 70 %. El viento se proyecta sobre el rumbo del tramo:

```text
viento de frente = viento × 0,7 × cos(dirección del viento − rumbo)
v_aire           = v + viento de frente
v_aire²          = v_aire × |v_aire|      (con signo: un viento de cola más rápido que el carro empuja)
```

`windDirDeg` es de dónde viene el viento, así que un viento del norte con el carro yendo al norte es de frente. Sin rumbo (por ejemplo, el desvío a un cargador) se usa el promedio sobre todas las direcciones: `v² + viento²/2`.

## Modo físico

Se usa cuando no hay consumo manual. CdA y Crr salen del vehículo si los trae; si no, de una tabla por carrocería (valores estimados). La eficiencia del tren todavía se estima por potencia.

### Coeficientes del vehículo

Área de arrastre (CdA, en m²) y rodadura (Crr): `vehicle.dragAreaM2` y `vehicle.rollingResistance` si el vehículo los trae. Si no, `BODY_TYPE_PHYSICS` según `vehicle.bodyType` (sin carrocería, `suv_compact`):

| Carrocería | CdA (m²) | Crr | Rango típico de Cd |
|---|---|---|---|
| `sedan` (sedán o hatchback) | 0,55 | 0,009 | 0,23–0,28 |
| `suv_compact` | 0,75 | 0,009 | 0,27–0,33 |
| `suv_large` (SUV grande o pickup) | 0,95 | 0,010 | 0,32–0,38 |

Son valores estándar de MVP, no del fabricante. Dentro de una misma carrocería el CdA real varía cerca de ±20 %, lo que da unos ±10–15 % de consumo en carretera. Para un vehículo con cifras reales, se agregan `dragAreaM2` y `rollingResistance` a su fila del catálogo (`seeds/0001_vehicle_catalog.sql`).

Eficiencia del tren motriz, entre 0,85 y 0,925:

```text
η = 0,86 + potencia / 2800
```

### Fuerzas en la rueda

La distancia pasa a metros (`km × 1000`). La velocidad del tramo se recorta entre 10 y 140 km/h y pasa a m/s.

```text
rodadura = Crr × masa × 9,81
aire     = 0,5 × ρ × CdA × v_aire²
```

Rodadura y aire se pasan a kWh (1 kWh = 3 600 000 J) y se les aplican el ciclo y el estilo. La gravedad va aparte, **con su signo**:

```text
resistencia = (rodadura + aire) × metros / 3 600 000 × ciclo × estilo
gravedad    = masa × 9,81 × desnivel / 3 600 000          (negativa en bajada)
rueda       = resistencia + gravedad
```

| Factor | Valor | A qué se aplica |
|---|---|---|
| Ciclo | 1,14 | Solo rodadura y aire. El modelo de fuerzas es de crucero; esto cubre aceleraciones, curvas y tráfico. Subir 1000 m no cuesta más por el tráfico. En el modo manual se apaga, porque el consumo del usuario ya lo trae. |
| Estilo | eficiente 0,95, normal 1, deportivo 1,08 | Solo rodadura y aire. La energía de una pendiente es la misma con cualquier estilo. |

### De la rueda a la batería

Si `rueda ≥ 0`, el tramo pide energía:

```text
tracción = rueda / η × clima
regen    = 0
```

Si `rueda < 0`, la bajada pagó toda la rodadura y el aire y sobra energía. No hay tracción y se regenera una parte del excedente:

```text
tracción = 0
regen    = −rueda × recuperación × factor de velocidad baja
```

En los dos casos:

```text
bruto = tracción + auxiliares
neto  = bruto − regen
```

Una bajada suave (por ejemplo, −2 % a 80 km/h) casi no gasta: la pendiente paga casi toda la rodadura y el aire, y no queda excedente que regenerar. Una bajada fuerte deja el neto negativo.

| Factor | Valor | Efecto |
|---|---|---|
| Clima por temperatura | Se interpola: 0 °C → 1,28; 5 °C → 1,16; 10 °C → 1,07; 15–26 °C → 1; 32 °C → 1,05; 38 °C → 1,10 | Batería, llantas y tren fríos o calientes. Antes eran escalones (14,9 °C daba 1,07 y 15 °C daba 1). |
| Auxiliares | `(potencia del clima + 0,45 kW) × horas` | 0,45 kW es electrónica de a bordo. El clima depende del modo y de la temperatura del tramo. |

Horas del tramo: `km / velocidad`.

Potencia del clima, en kW, antes de corregir por temperatura:

| Modo | kW |
|---|---|
| off | 0 |
| eco | 0,6 |
| normal | 1,2 |
| max | 2,2 |

Si no está apagado, por debajo de 12 °C suma `(12 − °C) × 0,06` kW de calor, y por encima de 24 °C suma `(°C − 24) × 0,05` kW de frío.

Junto con el factor de velocidad del planificador, el estilo queda cerca de −10 % en eficiente y +15 % en deportivo respecto de normal, en llano. Eficiente además va más lento y deportivo más rápido.

### Regeneración

El usuario elige uno de tres niveles. Cada nivel es la fracción del excedente de la rueda que termina en la batería. Ya incluye motor, inversor, batería y lo que se va por el freno de fricción:

| Nivel | Recuperación | Cuándo |
|---|---|---|
| Baja (`low`) | 0,35 | Regeneración suave o mucho uso del freno. |
| Media (`medium`) | 0,55 | Uso normal. Es el valor por defecto. |
| Alta (`high`) | 0,70 | Conducción de un pedal, anticipando las bajadas. |

La batería casi llena no acepta toda la regeneración. Eso lo aplica el SOCEngine, no el cálculo del tramo: la regeneración potencial se multiplica por una aceptación que vale 1 hasta 80 % de SOC, baja en línea y vale 0 desde 98 % (`ModelParameters.soc.regenAcceptance`). Lo que no se acepta queda en `regenCurtailedKwh` del plan.

Por debajo de 15 km/h la regeneración se multiplica por `velocidad / 15`. A 15 km/h o más vale 1.

El recuperado no puede pasar del 40 % de la potencia del motor durante las horas del tramo (`motorKw × 0,4 × horas`).

Antes la regeneración era un porcentaje (`regenPct`, por defecto 20) aplicado a toda la energía de la bajada, y la tracción se cobraba completa como en llano. Las condiciones guardadas con `regenPct` se leen así: hasta 10 → baja, 50 o más → alta, lo demás → media (`upgradeLegacyConditions` en `src/domain/schemas.ts` y `storedRegenLevel` en `src/lib/store.ts`).

## Modo manual

Se usa cuando el usuario fijó `consumptionKwhPer100km` y marcó el consumo como manual. Esa cifra es la base, a 70 km/h. La física solo añade el efecto del desnivel y la regeneración de la bajada.

Carretera, sin pendiente:

```text
kWh = (kWh/100km / 100) × km
      × factor de masa
      × factor de velocidad
      × estilo
      × clima
      + clima_kW × horas
```

El factor de masa no escala todo el peso. Solo el 40 % de lo que el viaje pesa de más o de menos que el vehículo en vacío:

```text
factor de masa = 1 + 0,4 × (masa del viaje / weightKg − 1)
```

El factor de velocidad reparte el consumo manual en una parte fija (58 %) y una de aire (42 % a 70 km/h). La parte de aire escala con la velocidad relativa al aire (con el viento del tramo) y con la densidad del aire del tramo frente a la del origen. La velocidad se recorta entre 30 y 140 km/h:

```text
factor = max(0,88;  0,58 + 0,42 × (v_aire² / 70²) × (ρ tramo / ρ origen))
```

Sin viento ni cambio de altura, a 70 km/h vale 1, a 100 km/h 1,44 y a 120 km/h 1,81. Antes se topaba en 1,55 (cerca de 108 km/h) y todo lo que iba más rápido costaba igual.

La pendiente no sale de esa base. Se calculan dos cortes físicos del mismo tramo, uno con el desnivel real y otro en llano, ambos sin el 1,14 de ciclo. La diferencia de netos es el efecto de la gravedad, con su signo:

```text
neto manual  = carretera + (neto con pendiente − neto en llano)
regeneración = la del corte con pendiente
bruto manual = max(0, neto manual + regeneración)
```

En subida la diferencia suma. En bajada resta: la pendiente descuenta de la base lo que ahorra en rodadura y aire, y además regenera el excedente.

`mixedCycleKwhPer100` en modo manual devuelve tal cual el número que escribió el usuario. En modo físico es el neto de 100 km llanos a 70 km/h, con un suelo de 8 kWh/100 km. Ese dato es la referencia del presupuesto de batería. El estado de carga de la ruta sigue saliendo tramo a tramo.

## Efecto de los cambios

Mismo SUV de prueba (1750 kg, 150 kW, 64 kWh, conductor, un pasajero, 20 kg de equipaje, clima eco, 22 °C, sin viento):

| Caso | Antes | Ahora |
|---|---|---|
| Llano 100 km a 90 km/h | 16,6 kWh | 16,5 kWh |
| Llano 100 km a 110 km/h | 21,0 kWh | 20,8 kWh |
| Llano 100 km a 90 km/h, a 2600 m | 16,6 kWh | 13,9 kWh |
| Puerto de 1500 m, subir y bajar, 80 km a 60 km/h | 17,9 kWh | 11,4 kWh |
| Perfil andino 212 km a 60 km/h (1000 → 3000 → 1500 → 2600 m), regeneración media | 44,1 kWh | 34,5 kWh |
| El mismo perfil, consumo manual de 17 kWh/100 km | 51,6 kWh | 46,7 kWh |

En llano casi no cambia. La diferencia está en las bajadas y en la altura.

## Qué no hace esta cuenta

- Sin `dragAreaM2` y `rollingResistance` en el vehículo, CdA y Crr son los estándar de su carrocería, no los del fabricante. La curva de carga tampoco es la del fabricante.
- No distingue la capacidad útil de la bruta ni la degradación de la batería. Usa `batteryKwh` completo.
- No modela semáforos uno a uno. El 1,14 del modo físico es el sustituto.
- El SOC de la curva no se recorta en 0: si el plan no alcanza, se ve cuánto falta (valores negativos).
- Usa un solo pronóstico de clima (a mitad de ruta) y lo corrige por altura; no cambia el viento a lo largo de la ruta.
- El alcance que se muestra en una parada (`rangeGainKm`) no sale de aquí. Ese número reparte los kWh cargados con la autonomía de ficha del auto.

## Código

- Energía por tramo y perfil de la ruta: `src/domain/energy.ts` (`segmentEnergyBreakdown`, `annotateEnergy`).
- Estado de carga, regeneración aceptada y eventos de carga y desvío: `src/domain/ev/engines/soc/simulate.ts`.
- Parámetros (Cd·A y Crr por carrocería, aceptación de regeneración, umbrales): `src/domain/ev/core/params.ts`.

Este documento se reescribe con el modelo del motor v2 en la fase F9 (`docs/arquitectura-ev/04-plan-de-trabajo.md`).
