# Cálculo de consumo de energía — modelo v2

Cómo calcula la energía el modelo v2 (`ENERGY_ENGINE=v2`, ADR-0012). Es física por tramo, sin multiplicadores de estilo, de ciclo ni de temperatura sobre el resultado. El modelo anterior sigue descrito en [calculo-consumo-energia.md](./calculo-consumo-energia.md) mientras sea el valor por defecto. En F9 este documento lo reemplaza.

Todos los números citados salen de `ModelParameters` (`src/domain/ev/core/params.ts`), cada uno con su fuente (`estimated`, `configurable`, `calculated`…). Cada plan lista en `assumptions` los valores `estimated` que pesaron en él (ADR-0015).

## Resumen del flujo

```text
ruta (muestras cada ~2 km + perfil de altura cada 100 m)
  → malla cada 100 m (más cada muestra y cada punto intermedio)
  → perfil de velocidad (típica, límites, curvas, aceleración y frenado)
  → energía de cada tramo de la malla (fuerzas → rueda → batería)
  → suma por muestra (EnergySample) → SOCEngine (regeneración que acepta la batería)
```

Código: `src/domain/ev/energy-v2.ts` (`energyProfileForRoute`), `engines/speed/engine.ts`, `engines/energy/{physics,environment,vehicle-params}.ts`.

## 1. La malla

`speedMesh` pone un punto cada `speed.meshSpacingM` = **100 m**. Además agrega el km exacto de cada muestra de la ruta, para que la energía de cada tramo caiga en una muestra, y cada punto intermedio del usuario, donde el vehículo se detiene. Los puntos a menos de 1 µm se fusionan conservando el km exacto.

La altura de cada punto sale del **perfil denso** (`RawRoute.elevationProfile`, un valor cada 100 m, ya limpio: pendiente máxima 15 %, suavizado 300 m, histéresis 5 m). Sin ese perfil, se interpola entre muestras, que están a ~2 km y pierden las subidas cortas (guía 05 §5.1).

## 2. Perfil de velocidad

Para cada punto de la malla (`buildSpeedProfile`):

1. **Velocidad típica:** la del proveedor en ese tramo, o la fija que puso el usuario.
2. **Objetivo del modo:** típica × `targetSpeedFactor` (eficiente 0,9 · normal 1 · deportivo 1,08).
3. **Tope legal:** el límite de velocidad del tramo. Si no hay límite, el tope por clase de vía (D8): primaria 90, secundaria 80, terciaria 60, local 50 y sin pavimentar 40 km/h.
4. **Tope por curva:** `v = √(a_lat · R)`, con `R` el radio del círculo que pasa por los puntos a ±100 m. `a_lat` vale 1,5 / 2 / 3 m/s² según el modo.
5. **Paradas:** 0 km/h en el origen, en el destino y en cada punto intermedio.
6. **Aceleración y frenado:** una pasada hacia adelante con `v_i ≤ √(v_{i−1}² + 2·a_max·Δs)` y otra hacia atrás con `v_i ≤ √(v_{i+1}² + 2·d_max·Δs)`. La aceleración máxima es 0,8 / 1,2 / 2 m/s² y el frenado máximo 0,8 / 1,5 / 2,5 m/s², según el modo.

El tiempo de manejo del plan es el de este perfil. Se compara con el del proveedor y la diferencia va a `dataQuality.providerDurationDeviationPct`, sin reescalar.

## 3. Energía de un tramo

Tramo de la malla con longitud horizontal `Δx`, desnivel `Δh`, y velocidades `v₁` y `v₂` al inicio y al final (aceleración constante):

| Magnitud | Fórmula |
|---|---|
| Ángulo | `θ = atan(Δh / Δx)` |
| Distancia | `d = Δx / cos θ` |
| Tiempo | `t = 2d / (v₁ + v₂)` |
| Aceleración | `a = (v₂² − v₁²) / 2d` |
| Velocidad media cuadrática | `v̄² = (v₁² + v₂²) / 2` |
| Rodadura | `F_r = Crr · m · g · cos θ` |
| Aerodinámica | `F_a = ½ · ρ · CdA · v_aire²` (con viento, ver §4) |
| Pendiente | `F_g = m · g · sin θ` |
| Inercia | `F_i = m_eff · a`, con `m_eff = m · factor de inercia rotacional` |
| En la rueda | `E_rueda = (F_r + F_a + F_g + F_i) · d` |

**De la rueda a la batería:**

- **Si `E_rueda ≥ 0` (tracción):** `E_tracción = E_rueda / η_tren × f(T)`, con `f(T)` el factor por temperatura (D4). Vale 1,28 a 0 °C, 1,16 a 5 °C, 1,07 a 10 °C, 1 entre 15 y 32 °C y 1,03 a 38 °C, interpolado.
- **Si `E_rueda < 0` (frenado):** la regeneración es `min(frenado × captura × η_regen, P_regen_max × fracción_potencia × t)`. El resto del frenado va a los frenos de fricción. La captura y la fracción de potencia dependen del nivel de regeneración: baja 0,45 / 0,5 · media 0,7 / 0,8 · alta 0,88 / 1.
- **Auxiliares, siempre (también en bajada):** `(P_aux + P_AC(T)) × t`. El aire acondicionado suma 0,6 / 1,2 / 2,2 kW según el nivel (eco / normal / máx.). Con él encendido, además, suma 0,06 kW por cada °C por debajo de 12 °C y 0,05 kW por cada °C por encima de 24 °C.
- **Neto del tramo:** `E_tracción + E_aux − E_regen`.

La suma de los tramos que caen en cada muestra da `energyGrossKwh`, `energyRegenKwh` y `energyKwh` (neto) de esa muestra.

## 4. Entorno

- **Temperatura del tramo:** la del usuario, que se supone a la altura del origen, o la del pronóstico, a la altura de su celda. Se corrige con el gradiente estándar de **6,5 °C por km** de altura. Sin ningún dato, 20 °C.
- **Densidad del aire:** presión barométrica estándar a la altitud del tramo y gas ideal: `ρ = p(h) / (287,05 · (273,15 + T))`.
- **Viento:** el pronóstico a 10 m, × 0,7 a la altura del carro. Con el rumbo del tramo, se proyecta sobre la vía (viento de frente o de cola). Sin rumbo se usa el promedio `v² + w²/2`. Se conserva por ADR-0004.

## 5. Parámetros del vehículo

`resolveVehicleEnergyParams`: lo que trae el vehículo (catálogo o editado por el usuario) se marca `configurable`. Lo que falta sale de `ModelParameters` como `estimated`:

| Parámetro | Por defecto | Fuente |
|---|---|---|
| Masa | peso del vehículo + pasajeros + equipaje | `calculated` |
| Cd·A, Crr | por carrocería (sedán 0,55 / 0,009 · SUV compacto 0,75 / 0,009 · SUV grande 0,95 / 0,010) | `estimated` (ADR-0002) |
| Factor de inercia rotacional | 1,05 | `estimated` |
| η del tren motriz (batería → rueda) | 0,90 | `estimated` |
| η de regeneración (rueda → batería) | 0,80 | `estimated` |
| Potencia máxima de regeneración | 60 kW | `estimated` |
| Auxiliares base | 0,45 kW | `estimated` |

La potencia del motor **no** se usa.

**Consumo manual:** si el usuario midió su consumo, no se multiplica el resultado. `calibrateToManual` escala Cd·A y Crr por un mismo factor `k` (acotado a [0,5; 2]) para que en llano, a 70 km/h y sin viento, tracción + auxiliares den ese consumo. La pendiente, la aceleración y la regeneración siguen siendo física.

## 6. Paradas y desvíos

- **Punto intermedio:** la velocidad baja a 0 en ese km (§2), así que frenar y arrancar entra en la física.
- **Desvío a una estación:** el consumo neto local de ±2 km del perfil (`localNetRateKwhPerKm`, nunca negativo) × km de ida y vuelta. A eso se suma detenerse y volver a arrancar (`stopEnergyKwh`): `½·m_eff·v²/η_tren − ½·m_eff·v²·captura·η_regen`, con la `v` del perfil en ese km.

## 7. De la energía al SOC

El perfil de energía no depende del SOC. El SOCEngine (`engines/soc/simulate.ts`) recorre las muestras y descuenta `bruto − regeneración aceptada`. La batería acepta toda la regeneración hasta **80 %**, nada desde **98 %**, y en medio en proporción lineal. Las cargas y los desvíos entran como eventos en su muestra. El SOC no se recorta en 0, para poder medir cuánto falta.

## 8. Qué no hace todavía

- Tráfico y congestión: la velocidad típica es la del proveedor.
- Estado de la batería (degradación) y su temperatura propia, fuera del factor `f(T)`.
- Superficie de la vía más allá del tope de velocidad por clase.
- Parámetros calibrados: casi todos son `estimated`. `npm run calibration:fit` propone valores con los viajes registrados ("¿Con cuánto llegaste?", guía 05 §5.8).

## Código

| Parte | Archivo |
|---|---|
| Composición | `src/domain/ev/energy-v2.ts` |
| Malla y perfil de velocidad | `src/domain/ev/engines/speed/engine.ts` |
| Física del tramo, perfil por muestra, desvío | `src/domain/ev/engines/energy/physics.ts` |
| Temperatura, aire, viento, aire acondicionado | `src/domain/ev/engines/energy/environment.ts` |
| Parámetros del vehículo | `src/domain/ev/engines/energy/vehicle-params.ts` |
| SOC y regeneración aceptada | `src/domain/ev/engines/soc/simulate.ts` |
| Parámetros y fuentes | `src/domain/ev/core/params.ts` |
