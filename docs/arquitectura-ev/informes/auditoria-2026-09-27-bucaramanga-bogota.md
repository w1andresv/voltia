# Auditoría · Bucaramanga → Bogotá con el motor v2 (2026-09-27)

## Reporte
- **Condiciones:** MG S5 EV al 100 % de batería, conector CCS2 (Tipo 2 / Combo 2), motor v2, estaciones de Blaze.
- **Síntoma:** el plan dice que llega con batería negativa. La ruta pasa por estaciones de carga en Santana y cerca de Tunja, pero no para en ellas.

## Causa raíz (corregida)
`isVerifiedForPlanning` (`src/domain/types.ts`) decide qué fuentes sirven para planificar. Al integrar Blaze se agregó la fuente `"blaze"` a `ChargerSource`, pero no a esta función, que terminaba en `return false`.

Efecto:
- Los dos planificadores descartaban **todas** las estaciones de Blaze antes de planificar.
- El mapa sí las mostraba, porque usa la elegibilidad del listado, que es otro filtro.
- Sin estaciones utilizables, el v2 responde "no viable" sin paradas, y la curva de batería sale de 100 % a negativo.

### Reproducción
Perfil aproximado de la ruta 45A/62 por los pueblos (421 km, Chicamocha, Arcabuco y Tunja), con estaciones de Blaze en Santana (km 188) y a 2 km de la vía en Tunja (km 288). Test: `src/domain/planner.bucaramanga-bogota.test.ts`.

| | Viable | Paradas | Llegada | Motivo |
|---|---|---|---|---|
| **Antes** | no | ninguna | −25,7 % | "No hay electrolineras verificadas y compatibles con el vehículo cerca de la ruta" |
| **Después** | sí | Santana (llega con 42 %, sale con 76 %, 21 min) y Tunja (36 % → 45 %, 9 min) | 15,5 % (reserva 15 %) | — |

El motivo de "antes" contradecía el mapa: las estaciones estaban, pero el filtro las rechazaba en silencio.

## Cambios
1. **Corrección:** `"blaze"` es una fuente aceptada para planificar. Su elegibilidad ya se evaluó al traducirla (coordenadas, estado y conectores).
2. **Para que no se repita:** `isVerifiedForPlanning` es ahora un `switch` exhaustivo sobre `ChargerSource`.
   - Una fuente nueva no compila hasta decidir si planifica.
   - En ejecución, una fuente desconocida (p. ej. de un snapshot viejo) se rechaza.
3. **Diagnóstico en el log:** en cada planificación, `[plan-trip:stations]` muestra el embudo completo:
   ```
   [plan-trip:stations] blaze: 143 en el listado → 8 a ≤ 12 km de la ruta → 7 elegibles → 7 aceptadas → 6 compatibles con MG S5 EV → 6 en servicio
     para planificar: blz_12 EDS … · …
     descartadas: blz_40 EDS … (sin conector compatible (tiene chademo)) · …
   ```
   Si una estación que se ve en el mapa no se usa, el log dice en qué filtro cayó y por qué. Reemplaza el log anterior, que contaba solo el primer filtro y por eso decía "sirven para planificar" cuando no era así.
4. **La ficha de las estaciones de Blaze** ya no las marca "No verificada", por la misma causa.
5. **Tests:**
   - regresión de extremo a extremo con estaciones traducidas por el adaptador de Blaze (`src/test-support/blaze-planning.test.ts`);
   - el caso de la ruta;
   - el embudo (`station-funnel.test.ts`).

## Otros hallazgos (no causan el error; propuestas)
| # | Hallazgo | Propuesta |
|---|---|---|
| A | Un plan inviable muestra "llega con −25 %". Técnicamente dice que no alcanza, pero se lee como un error del cálculo | ✅ **Hecho (2026-09-27).** `RoutePlan.depletion` (`batteryDepletion`, interpolado donde el SOC cruza 0 %). La UI muestra "Se queda sin batería en el km X, cerca de …" (Photon, por `reversePlaceFn`) junto al motivo; donde iba un SOC negativo dice "Sin batería"; la curva marca el punto con una línea roja y no baja de 0 % |
| B | Con Mapbox la energía de esta ruta es 66,8 kWh (subida 9117 m). Con el perfil aproximado da 59,7 kWh. Si la subida está inflada, el plan puede pedir una parada más o cargar de más | Contrastar la subida con un GPS real (O4, opcional). Si sobra, subir la histéresis o el suavizado de `ModelParameters.elevation.dense` |
| C | En modo "más rápido" el plan llega justo a la reserva (15,5 % contra 15 %): carga el mínimo en la última parada. Es lo esperado, pero se siente al límite | Opción de "margen extra al llegar", o usar "SOC de llegada" mayor que la reserva cuando el usuario lo pida |
| D | No hay un caso grabado con la ruta real y el listado real de Blaze | Cuando haya key: grabar la ruta y el listado (sin la key) como fixture, y agregarlo a la caracterización del v2 |
