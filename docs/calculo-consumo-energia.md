# Cálculo de consumo de energía

La ruta no usa los kWh/100 km de ficha como consumo del viaje. Cada tramo llama a `segmentEnergyKwh` en `src/domain/energy.ts`. Esa función devuelve los kWh netos que salen de la batería en ese tramo. El planificador la usa para el estado de carga, las paradas y la gráfica.

Hay dos motores. Si el vehículo tiene consumo manual (`consumptionManual` y `consumptionKwhPer100km` mayor que 0), entra `manualSlice`. Si no, entra `physicsSlice`. Los dos devuelven la misma forma.

## Entrada

```ts
segmentEnergyKwh(
  distanceKm,   // km del tramo
  elevDeltaM,   // metros de desnivel del tramo (subida positiva, bajada negativa)
  speedKmh,     // velocidad del tramo, km/h
  ctx,          // vehículo, condiciones del viaje, clima y altitud del origen
  socPct,       // % de batería al empezar el tramo (por defecto 50)
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
| `socPct` | Solo recorta la regeneración cuando la batería está muy llena. |

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
5. Se llama a `segmentEnergyBreakdown` con el estado de carga que hay al empezar ese tramo.
6. Se acumulan los kWh netos.
7. El estado de carga cambia: `soc − (neto / batería) × 100`, recortado entre 0 y 100. En bajada fuerte sube.

Cada muestra queda con `energyKwh` (neto del tramo), `energyGrossKwh`, `energyRegenKwh`, `cumulativeKwh`, `avgKwhPer100` y `soc`.

`energyBetween(muestras, desde, hasta)` es la resta de acumulados. Eso es lo que el plan usa para saber si llegas a un cargador o al destino. Puede ser negativa si el trecho es de bajada.

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

Si el estado de carga es 98 % o más, la recuperación pasa a 0. Entre 80 % y 98 % se reduce en línea hasta cero: a 80 % vale el nivel completo y a 98 % vale 0.

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
- No baja el estado de carga por debajo de 0 ni lo deja pasar de 100 al anotar la ruta.
- Usa un solo pronóstico de clima (a mitad de ruta) y lo corrige por altura; no cambia el viento a lo largo de la ruta.
- El alcance que se muestra en una parada (`rangeGainKm`) no sale de aquí. Ese número reparte los kWh cargados con la autonomía de ficha del auto.

## Código

El consumo del tramo y el recorrido de la ruta están en `src/domain/energy.ts`.

```ts
import type { RegenLevel, RouteSample, TripConditions, Vehicle, WeatherSnapshot } from "./types";
import { tripMassKg, safetyPct } from "./types";
import { bearingDeg, toRad } from "./geo";

const G = 9.81;
const J_PER_KWH = 3_600_000;
const REF_SPEED = 70;
const AUX_KW = 0.45;
const CYCLE_OVERHEAD = 1.14;
/** Gradiente térmico estándar de la atmósfera: °C que se pierden por km de altura. */
const LAPSE_C_PER_KM = 6.5;
/** El pronóstico da el viento a 10 m; a la altura del carro sopla más o menos un 70 %. */
const WIND_GROUND_FACTOR = 0.7;
/** Parte del consumo manual que se atribuye al aire a 70 km/h (el resto no depende de la velocidad). */
const MANUAL_AERO_SHARE = 0.42;
const MIN_SPEED_KMH = 10;
const MAX_SPEED_KMH = 140;
/** Tope de potencia de regeneración, como fracción de la potencia del motor. */
const REGEN_POWER_SHARE = 0.4;

/**
 * Estilo de conducción, en dos efectos separados (para no contarlo dos veces):
 *  - STYLE_SPEED_FACTOR: velocidad de crucero relativa a la de la ruta. Cambia el
 *    TIEMPO y, por la resistencia del aire, también el consumo (vía la física).
 *  - STYLE_MULT: forma de acelerar y frenar, a igual velocidad. Solo afecta la
 *    rodadura y el aire: la energía de subir una pendiente no depende del estilo.
 */
export const STYLE_SPEED_FACTOR: Record<TripConditions["drivingStyle"], number> = {
  efficient: 0.93,
  normal: 1,
  sport: 1.06,
};

export const STYLE_MULT: Record<TripConditions["drivingStyle"], number> = {
  efficient: 0.95,
  normal: 1,
  sport: 1.08,
};

/**
 * Fracción del excedente de energía en la rueda (lo que la bajada da de más
 * después de pagar rodadura y aire) que termina en la batería. Ya incluye
 * motor, inversor, batería y lo que se pierde en el freno de fricción.
 *  - low: regeneración suave o mucho uso del freno.
 *  - medium: uso normal (valor por defecto).
 *  - high: conducción de un pedal, anticipando las bajadas.
 */
export const REGEN_RECOVERY: Record<RegenLevel, number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.7,
};

const AC_KW: Record<TripConditions["ac"], number> = {
  off: 0,
  eco: 0.6,
  normal: 1.2,
  max: 2.2,
};

/** Factor por temperatura (batería, llantas y tren fríos o calientes). Se interpola entre estos puntos. */
const CLIMATE_POINTS: readonly (readonly [number, number])[] = [
  [0, 1.28],
  [5, 1.16],
  [10, 1.07],
  [15, 1],
  [26, 1],
  [32, 1.05],
  [38, 1.1],
];

export type EnergyMode = "manual" | "estimated";

export interface EnergyContext {
  vehicle: Vehicle;
  conditions: TripConditions;
  weather: WeatherSnapshot | null;
  /**
   * Altitud del origen (m). Es la altura a la que se asume la temperatura que
   * escribió el usuario; sin ella no se corrige la temperatura por altitud.
   */
  originAltitudeM?: number;
}

/** Datos del tramo que no son distancia, desnivel ni velocidad. Todos opcionales. */
export interface SegmentGeo {
  /** Altitud media del tramo, m s. n. m. Cambia la densidad del aire y la temperatura. */
  altitudeM?: number;
  /** Rumbo del tramo en grados (0 = norte, 90 = este). Orienta el viento. */
  headingDeg?: number;
}

export interface EnergySlice {
  grossKwh: number;
  regenKwh: number;
  netKwh: number;
}

export function hasManualConsumption(vehicle: Vehicle): boolean {
  return Boolean(
    vehicle.consumptionManual &&
    vehicle.consumptionKwhPer100km &&
    vehicle.consumptionKwhPer100km > 0,
  );
}

export function energyMode(vehicle: Vehicle): EnergyMode {
  return hasManualConsumption(vehicle) ? "manual" : "estimated";
}

/** Homologated WLTP pack-to-distance ratio. Reference only, not a trip guarantee. */
export function wltpKwhPer100(vehicle: Vehicle): number | null {
  if (!(vehicle.rangeKm > 0) || !(vehicle.batteryKwh > 0)) return null;
  return (vehicle.batteryKwh / vehicle.rangeKm) * 100;
}

export const BODY_TYPE_PHYSICS: Record<BodyType, { dragAreaM2: number; rollingResistance: number }> = {
  sedan: { dragAreaM2: 0.55, rollingResistance: 0.009 },
  suv_compact: { dragAreaM2: 0.75, rollingResistance: 0.009 },
  suv_large: { dragAreaM2: 0.95, rollingResistance: 0.01 },
};

export const DEFAULT_BODY_TYPE: BodyType = "suv_compact";

function bodyPhysics(vehicle: Vehicle) {
  return BODY_TYPE_PHYSICS[vehicle.bodyType ?? DEFAULT_BODY_TYPE] ?? BODY_TYPE_PHYSICS[DEFAULT_BODY_TYPE];
}

export function dragAreaM2(vehicle: Vehicle): number {
  return vehicle.dragAreaM2 ?? bodyPhysics(vehicle).dragAreaM2;
}

export function rollingCrr(vehicle: Vehicle): number {
  return vehicle.rollingResistance ?? bodyPhysics(vehicle).rollingResistance;
}

export function drivetrainEff(vehicle: Vehicle): number {
  return clamp(0.86 + vehicle.motorKw / 2800, 0.85, 0.925);
}

/** Fracción del excedente de bajada que vuelve a la batería según el nivel elegido. */
export function regenRecovery(conditions: TripConditions): number {
  return REGEN_RECOVERY[conditions.regenLevel] ?? REGEN_RECOVERY.medium;
}

/** Recuperación con la batería llena: completa hasta 80 %, baja en línea y es 0 desde 98 %. */
export function effectiveRegen(conditions: TripConditions, socPct = 50): number {
  if (socPct >= 98) return 0;
  const r = regenRecovery(conditions);
  return socPct > 80 ? (r * (98 - socPct)) / 18 : r;
}

export function climateMultiplier(tempC: number): number {
  const pts = CLIMATE_POINTS;
  if (tempC <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, m1] = pts[i]!;
    if (tempC <= t1) {
      const [t0, m0] = pts[i - 1]!;
      return m0 + ((m1 - m0) * (tempC - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1]![1];
}

export function acPowerKw(ac: TripConditions["ac"], tempC: number): number {
  const base = AC_KW[ac];
  if (base === 0) return 0;
  const heat = tempC < 12 ? (12 - tempC) * 0.06 : 0;
  const cool = tempC > 24 ? (tempC - 24) * 0.05 : 0;
  return base + heat + cool;
}

/**
 * Temperatura del tramo. La del usuario se asume a la altura del origen; la del
 * clima, a la altura de su celda del pronóstico. Si se conocen esa altura de
 * referencia y la del tramo, se corrige con el gradiente estándar (6,5 °C/km).
 */
export function segmentTempC(ctx: EnergyContext, altitudeM?: number): number {
  const { conditions, weather } = ctx;
  let base: number;
  let refAltitude: number | undefined;
  if (conditions.temperatureC != null) {
    base = conditions.temperatureC;
    refAltitude = ctx.originAltitudeM;
  } else if (weather) {
    base = weather.temperatureC;
    refAltitude = weather.elevationM;
  } else {
    return 20;
  }
  if (altitudeM == null || refAltitude == null) return base;
  return base - (LAPSE_C_PER_KM * (altitudeM - refAltitude)) / 1000;
}

/** Densidad del aire (kg/m³) por temperatura y altitud: presión barométrica estándar y gas ideal. */
export function airDensity(tempC: number, altitudeM = 0): number {
  const h = clamp(altitudeM, -500, 6000);
  const pressurePa = 101_325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return pressurePa / (287.05 * (273.15 + tempC));
}

/**
 * Cuadrado de la velocidad relativa al aire (m²/s²), con signo: negativo si el
 * viento de cola es más rápido que el carro. Con rumbo, el viento se proyecta
 * sobre la vía (`windDirDeg` es de dónde viene). Sin rumbo se usa el promedio
 * sobre todas las direcciones: v² + w²/2.
 */
export function airSpeedSq(
  speedKmh: number,
  weather: WeatherSnapshot | null,
  headingDeg?: number,
): number {
  const v = speedKmh / 3.6;
  const w = ((weather?.windKmh ?? 0) * WIND_GROUND_FACTOR) / 3.6;
  if (!(w > 0)) return v * v;
  if (headingDeg == null || !Number.isFinite(weather?.windDirDeg)) return v * v + (w * w) / 2;
  const headwind = w * Math.cos(toRad((weather!.windDirDeg as number) - headingDeg));
  const va = v + headwind;
  return va * Math.abs(va);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampSpeed(speedKmh: number): number {
  return clamp(speedKmh || REF_SPEED, MIN_SPEED_KMH, MAX_SPEED_KMH);
}

/**
 * Factor de velocidad del modo manual, relativo a 70 km/h. El consumo manual se
 * reparte en una parte fija (58 %) y una de aire (42 % a 70 km/h) que escala con
 * la velocidad relativa al aire y con la densidad del aire frente a la del origen.
 */
export function manualSpeedFactor(
  speedKmh: number,
  ctx: EnergyContext,
  geo: SegmentGeo = {},
): number {
  const speed = clamp(speedKmh || REF_SPEED, 30, MAX_SPEED_KMH);
  const alt = geo.altitudeM;
  const refAlt = ctx.originAltitudeM;
  const rhoRatio =
    alt != null && refAlt != null
      ? airDensity(segmentTempC(ctx, alt), alt) / airDensity(segmentTempC(ctx, refAlt), refAlt)
      : 1;
  const refSq = (REF_SPEED / 3.6) ** 2;
  const aeroRatio = (airSpeedSq(speed, ctx.weather, geo.headingDeg) / refSq) * rhoRatio;
  return Math.max(0.88, 1 - MANUAL_AERO_SHARE + MANUAL_AERO_SHARE * aeroRatio);
}

function physicsSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct: number,
  geo: SegmentGeo = {},
  opts?: { includeCycle?: boolean },
): EnergySlice {
  const { vehicle, conditions, weather } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const speed = clampSpeed(speedKmh);
  const altitude = geo.altitudeM ?? ctx.originAltitudeM ?? 0;
  const temp = segmentTempC(ctx, geo.altitudeM);
  const hours = distanceKm / speed;
  const aux = (acPowerKw(conditions.ac, temp) + AUX_KW) * hours;
  const eff = drivetrainEff(vehicle);
  const cycle = opts?.includeCycle === false ? 1 : CYCLE_OVERHEAD;
  const dM = distanceKm * 1000;

  const fRoll = rollingCrr(vehicle) * mass * G;
  const fAero =
    0.5 *
    airDensity(temp, altitude) *
    dragAreaM2(vehicle) *
    airSpeedSq(speed, weather, geo.headingDeg);
  // Rodadura y aire, con el ciclo (aceleraciones, curvas, tráfico) y el estilo.
  const resistKwh =
    (((fRoll + fAero) * dM) / J_PER_KWH) * cycle * STYLE_MULT[conditions.drivingStyle];
  // Gravedad con signo: en bajada paga primero la rodadura y el aire.
  const gravityKwh = (mass * G * elevDeltaM) / J_PER_KWH;
  const wheelKwh = resistKwh + gravityKwh;

  let traction = 0;
  let regen = 0;
  if (wheelKwh >= 0) {
    traction = (wheelKwh / eff) * climateMultiplier(temp);
  } else {
    // Solo el excedente se puede regenerar, y no más rápido que el tope del motor.
    const speedRegen = speed < 15 ? speed / 15 : 1;
    const capKwh = Math.max(0, vehicle.motorKw * REGEN_POWER_SHARE * hours);
    regen = Math.min(-wheelKwh * effectiveRegen(conditions, socPct) * speedRegen, capKwh);
  }
  const gross = traction + aux;
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

function manualSlice(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct: number,
  geo: SegmentGeo = {},
): EnergySlice {
  const { vehicle, conditions } = ctx;
  const mass = tripMassKg(vehicle, conditions);
  const massRatio = mass / Math.max(vehicle.weightKg, 1);
  const massFactor = 1 + 0.4 * (massRatio - 1);
  const speed = clampSpeed(speedKmh);
  const temp = segmentTempC(ctx, geo.altitudeM);
  const basePerKm = (vehicle.consumptionKwhPer100km as number) / 100;
  const hours = distanceKm / speed;
  const road =
    basePerKm *
      distanceKm *
      massFactor *
      manualSpeedFactor(speed, ctx, geo) *
      STYLE_MULT[conditions.drivingStyle] *
      climateMultiplier(temp) +
    acPowerKw(conditions.ac, temp) * hours;
  // Efecto del desnivel = física con pendiente − física en llano (sin el ciclo, que
  // ya viene en el consumo manual). En bajada es negativo y descuenta de la base.
  const phys = physicsSlice(distanceKm, elevDeltaM, speed, ctx, socPct, geo, {
    includeCycle: false,
  });
  const flat = physicsSlice(distanceKm, 0, speed, ctx, socPct, geo, { includeCycle: false });
  const net = road + (phys.netKwh - flat.netKwh);
  const regen = phys.regenKwh;
  const gross = Math.max(0, net + regen);
  return { grossKwh: gross, regenKwh: regen, netKwh: gross - regen };
}

/**
 * Energía del tramo. `netKwh` puede ser negativo en una bajada fuerte: la
 * batería gana carga.
 */
export function segmentEnergyBreakdown(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct = 50,
  geo: SegmentGeo = {},
): EnergySlice {
  if (distanceKm <= 0) return { grossKwh: 0, regenKwh: 0, netKwh: 0 };
  if (hasManualConsumption(ctx.vehicle))
    return manualSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo);
  return physicsSlice(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo);
}

/** Mixed-cycle reference at ~70 km/h on flat, kWh/100 km. */
export function mixedCycleKwhPer100(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
): number {
  if (hasManualConsumption(vehicle)) return vehicle.consumptionKwhPer100km as number;
  const e = physicsSlice(100, 0, REF_SPEED, { vehicle, conditions, weather }, 50).netKwh;
  return Math.max(8, e);
}

/**
 * Net energy for a route slice. Same engine as SOC, charge stops and the chart.
 */
export function segmentEnergyKwh(
  distanceKm: number,
  elevDeltaM: number,
  speedKmh: number,
  ctx: EnergyContext,
  socPct = 50,
  geo: SegmentGeo = {},
): number {
  return segmentEnergyBreakdown(distanceKm, elevDeltaM, speedKmh, ctx, socPct, geo).netKwh;
}

export function annotateEnergy(
  samples: Omit<
    RouteSample,
    "energyKwh" | "energyGrossKwh" | "energyRegenKwh" | "cumulativeKwh" | "avgKwhPer100" | "soc"
  >[],
  ctx: EnergyContext,
  initialSoc: number,
): RouteSample[] {
  const cap = Math.max(ctx.vehicle.batteryKwh, 1);
  const energyCtx: EnergyContext = {
    ...ctx,
    originAltitudeM: ctx.originAltitudeM ?? samples[0]?.elevM,
  };
  let cum = 0;
  let soc = initialSoc;
  const out: RouteSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    let gross = 0;
    let regen = 0;
    let net = 0;
    if (i > 0) {
      const prev = samples[i - 1]!;
      const dKm = Math.max(0, s.km - prev.km);
      const dElev = s.elevM - prev.elevM;
      const geo: SegmentGeo = {
        altitudeM: (prev.elevM + s.elevM) / 2,
        headingDeg: bearingDeg(prev, s),
      };
      const slice = segmentEnergyBreakdown(dKm, dElev, s.speedKmh, energyCtx, soc, geo);
      gross = slice.grossKwh;
      regen = slice.regenKwh;
      net = slice.netKwh;
    }
    cum += net;
    soc = clamp(soc - (net / cap) * 100, 0, 100);
    const avg = s.km > 0.3 ? (cum / s.km) * 100 : 0;
    out.push({
      ...s,
      energyKwh: net,
      energyGrossKwh: gross,
      energyRegenKwh: regen,
      cumulativeKwh: cum,
      avgKwhPer100: avg,
      soc,
    });
  }
  return out;
}

export function energyBetween(samples: RouteSample[], fromIdx: number, toIdx: number): number {
  const a = samples[Math.max(0, fromIdx)]!;
  const b = samples[Math.min(samples.length - 1, toIdx)]!;
  return b.cumulativeKwh - a.cumulativeKwh;
}

export function batteryBudget(
  vehicle: Vehicle,
  conditions: TripConditions,
  weather: WeatherSnapshot | null,
): {
  floorPct: number;
  usablePct: number;
  usableKwh: number;
  reservedKwh: number;
  packedKwh: number;
  rangeKm: number;
  per100: number;
  energyMode: EnergyMode;
  wltpKm: number;
  wltpKwhPer100: number | null;
} {
  const floorPct = Math.max(
    safetyPct(conditions),
    vehicle.minSocRecommended,
    conditions.arrivalSoc,
  );
  const usablePct = Math.max(0, conditions.initialSoc - floorPct);
  const packedKwh = (conditions.initialSoc / 100) * vehicle.batteryKwh;
  const usableKwh = (usablePct / 100) * vehicle.batteryKwh;
  const reservedKwh = (floorPct / 100) * vehicle.batteryKwh;
  const per100 = mixedCycleKwhPer100(vehicle, conditions, weather);
  const rangeKm = per100 > 0 ? (usableKwh / per100) * 100 : 0;
  return {
    floorPct,
    usablePct,
    usableKwh,
    reservedKwh,
    packedKwh,
    rangeKm,
    per100,
    energyMode: energyMode(vehicle),
    wltpKm: vehicle.rangeKm,
    wltpKwhPer100: wltpKwhPer100(vehicle),
  };
}
```

La velocidad de cada tramo y el largo de cada tramo los fijan `speedProfile`, `applySegmentSpeeds` y `buildSamples` en `src/infrastructure/providers/routing.osrm.ts`. Mapbox también pasa por estas funciones.

```ts
/** Distancia (km) y tiempo (s) acumulados a lo largo de la ruta, según el motor. */
export interface SpeedProfile {
  cumKm: number[];
  cumS: number[];
}

/**
 * Perfil de tiempo de la ruta: primero las anotaciones por par de puntos
 * (annotations=distance,duration); si no vienen, los pasos (steps=true de
 * Mapbox). Sin ninguno de los dos, null y se usa la velocidad media.
 */
export function speedProfile(route: OsrmRoute): SpeedProfile | null {
  const pieces: [number, number][] = [];
  for (const leg of route.legs ?? []) {
    const d = leg.annotation?.distance;
    const t = leg.annotation?.duration;
    if (d?.length && t?.length === d.length) {
      d.forEach((m, i) => pieces.push([m, t[i]!]));
    } else if (leg.steps?.length) {
      for (const st of leg.steps) pieces.push([st.distance, st.duration]);
    } else {
      return null;
    }
  }
  if (!pieces.length) return null;
  const cumKm = [0];
  const cumS = [0];
  for (const [m, sec] of pieces) {
    if (!(m >= 0) || !(sec >= 0)) continue;
    cumKm.push(cumKm[cumKm.length - 1]! + m / 1000);
    cumS.push(cumS[cumS.length - 1]! + sec);
  }
  const totalKm = cumKm[cumKm.length - 1]!;
  const totalS = cumS[cumS.length - 1]!;
  return totalKm > 0 && totalS > 0 ? { cumKm, cumS } : null;
}

function timeAtKm(profile: SpeedProfile, km: number): number {
  const { cumKm, cumS } = profile;
  if (km <= 0) return 0;
  // Búsqueda binaria del tramo que contiene `km`.
  let lo = 0;
  let hi = cumKm.length - 1;
  if (km >= cumKm[hi]!) return cumS[hi]!;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumKm[mid]! <= km) lo = mid;
    else hi = mid;
  }
  const span = cumKm[hi]! - cumKm[lo]!;
  const t = span > 0 ? (km - cumKm[lo]!) / span : 0;
  return cumS[lo]! + t * (cumS[hi]! - cumS[lo]!);
}

/** Límites de la velocidad de un tramo tomada del motor de rutas, km/h. */
const SEGMENT_SPEED_MIN = 8;
const SEGMENT_SPEED_MAX = 130;

/**
 * Velocidad de cada muestra = distancia / tiempo del motor entre la muestra
 * anterior y esta. Las muestras van en km de la ruta; el perfil se escala a esa
 * misma distancia. La primera muestra toma la velocidad del primer tramo.
 */
export function applySegmentSpeeds(
  samples: RawRoute["samples"],
  profile: SpeedProfile | null,
  distanceKm: number,
): RawRoute["samples"] {
  if (!profile || samples.length < 2 || !(distanceKm > 0)) return samples;
  const scale = profile.cumKm[profile.cumKm.length - 1]! / distanceKm;
  const out = samples.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!.km;
    const b = out[i]!.km;
    const dt = timeAtKm(profile, b * scale) - timeAtKm(profile, a * scale);
    if (!(b > a) || !(dt > 0)) continue;
    const kmh = ((b - a) * scale) / (dt / 3600);
    out[i]!.speedKmh = Math.max(SEGMENT_SPEED_MIN, Math.min(SEGMENT_SPEED_MAX, kmh));
  }
  out[0]!.speedKmh = out[1]!.speedKmh;
  return out;
}

function buildSamples(
  coords: [number, number][],
  distanceKm: number,
  durationMin: number,
): RawRoute["samples"] {
  const points: LatLon[] = coords.map(([lon, lat]) => ({ lat, lon }));
  const geomLen = polylineLengthKm(points) || distanceKm;
  const everyKm = Math.max(0.8, distanceKm / 220);
  const samples: RawRoute["samples"] = [];
  const avgSpeed = Math.max(28, Math.min(125, (distanceKm / Math.max(durationMin, 1)) * 60));

  samples.push({
    km: 0,
    lat: points[0]!.lat,
    lon: points[0]!.lon,
    elevM: 0,
    slopePct: 0,
    speedKmh: avgSpeed,
  });

  let acc = 0;
  let nextAt = everyKm;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(
      (b.lat - a.lat) * 111.32,
      (b.lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180),
    );
    if (d === 0) continue;
    while (acc + d >= nextAt && nextAt < geomLen - everyKm * 0.4) {
      const t = (nextAt - acc) / d;
      const p = interpolatePoint(a, b, t);
      const km = (nextAt / geomLen) * distanceKm;
      samples.push({
        km,
        lat: p.lat,
        lon: p.lon,
        elevM: 0,
        slopePct: 0,
        speedKmh: avgSpeed,
      });
      nextAt += everyKm;
    }
    acc += d;
  }

  const last = points[points.length - 1]!;
  samples.push({
    km: distanceKm,
    lat: last.lat,
    lon: last.lon,
    elevM: 0,
    slopePct: 0,
    speedKmh: avgSpeed,
  });
  return samples;
}
```
