# Pendientes del motor EV v2 y guía para terminarlo

Este documento lista, paso por paso, todo lo que falta para terminar el motor de rutas EV v2 y llevarlo a `main`. Para cada pendiente dice cómo hacerlo, qué archivos toca, qué tests hacen falta y cuándo se da por cerrado. También incluye lo que hay que tener instalado, configurado y decidido antes de empezar.

- **Estado al escribirlo:** 2026-09-26, rama `engine-v2`, commit `d8605e2`, 601 tests en verde, CI en verde.
- **Documentos relacionados:**
  - [`02-plan-arquitectura-modular.md`](./02-plan-arquitectura-modular.md): el plan, el qué;
  - [`prompt_ev_route_engine_v2.md`](./prompt_ev_route_engine_v2.md): la especificación;
  - [`04-plan-de-trabajo.md`](./04-plan-de-trabajo.md): el estado por fase;
  - [`../adr/`](../adr/): las decisiones.

---

## Índice

1. [Resumen del estado](#1-resumen-del-estado)
2. [Requisitos para desarrollar](#2-requisitos-para-desarrollar)
3. [Decisiones pendientes del dueño del producto](#3-decisiones-pendientes-del-dueño-del-producto)
4. [Tareas operativas (sin código)](#4-tareas-operativas-sin-código)
5. [Pendientes de código, por fase](#5-pendientes-de-código-por-fase)
   - [5.1 F2b · Elevación](#51-f2b--elevación)
   - [5.2 F4 · Desvíos medidos con la matriz de Mapbox](#52-f4--desvíos-medidos-con-la-matriz-de-mapbox)
   - [5.3 F5 · Energía v2: lo que falta](#53-f5--energía-v2-lo-que-falta)
   - [5.4 F6 · Quitar los multiplicadores](#54-f6--quitar-los-multiplicadores)
   - [5.5 F7 · Planificador v2: lo que falta](#55-f7--planificador-v2-lo-que-falta)
   - [5.6 F8 · Pasada 2 al guardar y compartir; activar v2](#56-f8--pasada-2-al-guardar-y-compartir-activar-v2)
   - [5.7 FB · Fuente de datos Blaze (Muvatec)](#57-fb--fuente-de-datos-blaze-muvatec)
   - [5.8 Calibración (`TripObservation`)](#58-calibración-tripobservation)
   - [5.9 Invariantes e informe de la especificación (§8.4 y §8.5)](#59-invariantes-e-informe-de-la-especificación-84-y-85)
   - [5.10 F9 · Limpieza y paso a `main`](#510-f9--limpieza-y-paso-a-main)
6. [Orden recomendado y dependencias](#6-orden-recomendado-y-dependencias)
7. [Cómo se trabaja cada pendiente](#7-cómo-se-trabaja-cada-pendiente)
8. [Riesgos y cómo evitarlos](#8-riesgos-y-cómo-evitarlos)
9. [Mapa del código](#9-mapa-del-código)

---

## 1. Resumen del estado

| Fase | Qué es | Estado | Falta |
|---|---|---|---|
| F0 | Caracterización, CI, hook de sesión | ✅ | — (la cassette real se omitió por decisión, P1) |
| F1 | Contratos, puertos, servicio | ✅ | — |
| F2a | Datos crudos del proveedor; muestreo y elevación en el dominio | ✅ | — |
| F2b | Elevación configurable (`ELEVATION_SOURCE`) | ✅ | `mapbox-terrain` por defecto, caché sin vencimiento, túneles, pendiente máxima y error tipado. Tileset verificado con datos reales (O4, `mediciones/elevacion-2026-09-26.md`); falta el costo (O6) |
| F3 | SOC separado de la energía | ✅ | — |
| F4 | Corredor, compatibilidad, curva de carga | ✅ | Desvíos medidos detrás de `DETOUR_SOURCE=matrix` (ADR-0013); activarlo tras revisar el cupo (O6) |
| F5 | Energía v2 y perfil de velocidad (`ENERGY_ENGINE`) | 🟡 | Medir en sombra, publicar Cd·A por vehículo (`db:seed`) y calibración (0 km/h en tramos, desvío local, tope por vía y frío: ✅ sesión A) |
| F6 | Quitar los multiplicadores | ⏳ | Todo (depende de F5 medido) |
| F7 | Planificador por programación dinámica (`PLANNER_ENGINE`) | 🟡 | Medir en sombra y activar `v2` |
| F8 | Composición, gráficas, pasada 2, snapshot | 🟡 | Activar `v2` (D2). La verificación al compartir está hecha |
| FB | Blaze como fuente única | 🟡 | Listado, detalle de paradas y ficha hechos; falta `BLAZE_API_KEY` y `npm run blaze:check` con la key real |
| F9 | Limpieza y paso a `main` | ⏳ | Todo |

**Qué ve hoy un usuario:** con las variables por defecto (`PLANNER_ENGINE=legacy`, `ENERGY_ENGINE=legacy`, `ELEVATION_SOURCE=mapbox-terrain`) la app planifica con el motor v1, pero con la elevación densa de Mapbox. Desde 2026-09-27 cualquiera puede elegir v2 en el selector del planificador (`ENGINE_PREVIEW_EMAILS=*`). Lo que cambió para todos:
- las correcciones de F0 a F4 (reserva en todo el tramo, SOC separado de la energía, compatibilidad y adaptadores);
- las gráficas por tramo;
- los viajes guardados con su snapshot.

---

## 2. Requisitos para desarrollar

### 2.1 Herramientas

| Qué | Versión | Para qué |
|---|---|---|
| Node.js | ≥ 20.12 (CI usa 22) | `process.loadEnvFile` en los scripts que leen `.env.local` |
| npm | la que trae Node | `npm ci` / `npm install` |
| Git | cualquiera reciente | ramas y commits |
| Navegador | cualquiera | probar la app en `http://localhost:8080` (`npm run dev` usa el puerto **8080**) |

### 2.2 Cuentas y accesos

| Servicio | Para qué | Qué hace falta |
|---|---|---|
| Mapbox | Rutas (Directions), límites de velocidad (`maxspeed`), teselas de terreno, matriz de distancias (pendiente) | Un token **de servidor** sin restricción por URL en `MAPBOX_ACCESS_TOKEN`. Revisar en el plan contratado el cupo de Directions, Matrix y teselas raster |
| Open-Meteo | Elevación y clima | Sin cuenta. El uso gratuito es **no comercial**: si Voltia cobra, hay que pasar a su plan de pago |
| Supabase (Postgres) | Vehículos, viajes, electrolineras | `DATABASE_URL` (pooler, puerto 6543) y `DIRECT_URL` (puerto 5432, para scripts) |
| Vercel | Despliegue | Acceso al proyecto para cambiar variables de entorno y leer los logs |
| GitHub | Repo `w1andresv/voltia` | Permiso de escritura en `engine-v2` y para abrir el PR a `main` |
| Blaze (Muvatec) | Fuente única futura | URL base y credencial de la API, y la documentación exportada (ver §5.7) |

### 2.3 Variables de entorno

En local van en `.env.local` (no se sube al repo). En Vercel, en *Settings → Environment Variables*. La lista completa, con comentarios, está en [`.env.example`](../../.env.example).

| Variable | Valores | Por defecto | Para qué |
|---|---|---|---|
| `MAPBOX_ACCESS_TOKEN` | token `pk.`/`sk.` | — | Rutas, límites, terreno. Sin él, rutas por OSRM |
| `DATABASE_URL` / `DIRECT_URL` | URL de Postgres | — | Base de datos |
| `PLANNER_ENGINE` | `legacy` · `shadow` · `v2` | `legacy` | Planificador de paradas (ADR-0007) |
| `ENERGY_ENGINE` | `legacy` · `shadow` · `v2` | `legacy` | Modelo de energía (ADR-0012) |
| `ELEVATION_SOURCE` | `open-meteo` · `open-meteo-adaptive` · `mapbox-terrain` | `open-meteo` | Fuente de elevación (ADR-0011) |
| `DETOUR_SOURCE` | `estimated` · `matrix` | `estimated` | Desvíos a las estaciones (ADR-0013) |
| `ENGINE_PREVIEW_EMAILS` | `*` o correos separados por coma | `*` (todos, desde 2026-09-27) | Quién ve el selector de motor v1/v2 en el planificador; la elección de cada usuario manda sobre `PLANNER_ENGINE` y `ENERGY_ENGINE` solo para su planificación |
| `BLAZE_API_URL`, `BLAZE_API_KEY`, `DATA_SOURCE` | — | — | Futuras (FB, §5.7) |

Un valor inválido en `PLANNER_ENGINE`, `ENERGY_ENGINE` o `ELEVATION_SOURCE` cae al valor por defecto; no rompe la app.

### 2.4 Comandos

| Comando | Qué hace | ¿Usa red o base? |
|---|---|---|
| `npm install` | Dependencias | npm |
| `npm run dev` | App en `http://localhost:8080` | Sí (proveedores y base) |
| `npm run typecheck` | TypeScript | No |
| `npm run lint` | ESLint, incluidas las reglas de capas | No |
| `npm test` | Vitest y los tests de scripts | No |
| `npm run test:coverage` | Cobertura con umbrales 80/80/80/70 (CI) | No |
| `npm run build` | Build de producción | No |
| `npm run elevation:compare` | Compara las tres fuentes de elevación sobre una ruta real (`ORIGIN=lat,lon DESTINATION=lat,lon` opcionales) | Mapbox y Open-Meteo |
| `npm run calibration:report` | Error del modelo según lo que anotaron los usuarios (D13), por modelo y vehículo | Base (solo lectura) |
| `npm run report` | Informe del plan (§8.5) en `docs/arquitectura-ev/informes/`; sintético por defecto, `REAL=1` con Mapbox | Sin red (sintético) o Mapbox |
| `npm run snapshot:record` | Graba la cassette real (opcional, P1 omitido; `STATIONS_URL` evita la base) | Mapbox, Open-Meteo y base o API |

**Antes de cada commit:** `npm run typecheck && npm run lint && npm test`. CI además corre la cobertura y el build.

### 2.5 En las sesiones de Claude Code en la nube

- **Dependencias:** el hook `.claude/hooks/session-start.sh` las instala al abrir la sesión.
- **Red:** la sesión bloquea `api.mapbox.com`, `api.open-meteo.com`, `photon.komoot.io` y `blaze.muvatec.com`. Para probar contra proveedores reales hay que habilitarlos en la configuración del entorno (*Edit → Network access*), o correr esas pruebas en tu computador.
- **Base de producción:** la sesión no la lee (política). Todo lo que necesite la base se corre en local.

---

## 3. Decisiones pendientes del dueño del producto

Cada una desbloquea algo. Cuando se tome, va a un ADR (o se actualiza el que se indica). Las decisiones tomadas quedan registradas en §3.1.

| # | Decisión | Opciones | Recomendación | Desbloquea | Dónde queda |
|---|---|---|---|---|---|
| D1 ✅ | Fuente de elevación por defecto (B6) — **decidido: `mapbox-terrain`** | `open-meteo`, `open-meteo-adaptive`, `mapbox-terrain` | `mapbox-terrain` si `elevation:compare` confirma que funciona y el costo cabe en el plan de Mapbox | F2b | ADR-0011 → "aceptada con fuente X" |
| D2 ✅ | Cuándo pasar `PLANNER_ENGINE` a `v2` — **decidido: tras 1–2 semanas en sombra** | Ya, tras N días en sombra, o tras revisar X viajes | Tras 1–2 semanas en `shadow` sin diferencias inexplicadas en `[plan-trip:shadow]` | F8, F9 | ADR-0007 |
| D3 ✅ | Cuándo pasar `ENERGY_ENGINE` a `v2` y el rango aceptable de diferencia — **decidido: lo decide el dueño con la variable `ENERGY_ENGINE`** | Por ejemplo ±10 % de energía y ±10 min por ruta | Definir el rango antes de mirar los datos; si la mayoría de viajes cae dentro, activar | F6 | ADR-0012 → nuevo ADR de F6 |
| D4 ✅ | Efecto del frío en la energía v2 — **decidido: agregarlo ya** | Nada (hoy), un factor de eficiencia por temperatura (`EfficiencyModel`), o calefacción más alta | Esperar datos: si los viajes a Bogotá (≈14 °C) salen bajos en sombra, agregar el modelo | F5 | ADR-0012 |
| D5 ✅ | Modo `sport` sin dato de congestión — **decidido: +8 % con tope legal** | +8 % sobre la velocidad típica con tope legal (hoy) o ir al límite legal | Mantener +8 % hasta tener congestión | — | ADR-0012 |
| D6 ✅ | Verificar la pasada 2 al guardar y al compartir — **decidido: solo al compartir** | Sí (1–3 rutas más por viaje guardado) o no | Sí: se guardan pocos viajes y el resultado queda en el snapshot | F8 | ADR-0009 |
| D7 ✅ | La UI en F9: leer `EVRoutePlan` o conservar `RoutePlan` — **decidido: conservar `RoutePlan` ampliado** | Migrar todos los componentes o renombrar `RoutePlan` como contrato definitivo | Conservar `RoutePlan` ampliado (menos riesgo, ya tiene todo); ver §5.10 | F9 | Nuevo ADR |
| D8 ✅ | Tabla de velocidad por clase vial cuando no hay límite — **decidido: tabla propuesta (90/80/60/50/40)** | Valores de la normativa colombiana vigente | Confirmar con la normativa y marcar `configurable` | F5 | `ModelParameters.speed` |
| D9 ✅ | Datos de Blaze — **decidido: solo electrolineras (listado + detalle por estación)** | Qué endpoints hay y qué reemplazan | Llenar la tabla de §5.7 | FB | ADR-0008 |
| D10 ✅ | Cómo se une `engine-v2` a `main` — **decidido: merge commit** | Merge commit o squash | Merge commit: conserva un commit por fase y los ADR citan esos commits | F9 | ADR-0001 |
| D13 ✅ | Cómo registra el usuario un viaje real para calibrar — **decidido: "¿Con cuánto llegaste?" en Mis viajes** | Al terminar el viaje, un botón "¿Con cuánto llegaste?" (SOC de llegada, y opcionalmente intermedios), o importar datos del vehículo (API del fabricante, OBD) | Empezar con el SOC de llegada en "Mis viajes" (una tabla nueva `voltia_trip_observations`); importar después | Calibración (§5.8) | Nuevo ADR |
| D11 ✅ | Espera en estación "ocupada" — **decidido: 15 min hasta tener datos** | 15 min (hoy, estimado) o calibrado | Mantener hasta tener datos de ocupación (Blaze) | F7 | `ModelParameters.planner.occupiedWaitMin` |

---

### 3.1 Decisiones tomadas

| # | Fecha | Decisión | Consecuencia en este documento |
|---|---|---|---|
| D1 | 2026-09-26 | **`mapbox-terrain`** como fuente de elevación por defecto | §5.1.1 pasa a "hacer": cambiar el valor por defecto, servir teselas en el fetch sintético y regenerar la caracterización. O4 queda para verificar el tileset y el costo, no para elegir |
| D2 | 2026-09-26 | **`PLANNER_ENGINE=v2` tras 1–2 semanas en `shadow`** en producción, si `[plan-trip:shadow]` no muestra diferencias sin explicar | O3 es requisito; al cerrar el periodo se resume en el ADR-0007 y se cambia el valor por defecto (§5.5) |
| D3 | 2026-09-26 | **Sin rango numérico: el dueño del producto decide cuándo activar la energía v2**, con la variable `ENERGY_ENGINE` (ya existe: `legacy` · `shadow` · `v2`) | La variable se conserva hasta que él dé el visto bueno. F6 (§5.4) no empieza hasta que lo pida explícitamente; mientras tanto el modelo anterior sigue en el código |
| D4 | 2026-09-26 | **Agregar ya el efecto del frío** a la energía v2: eficiencia del tren motriz en función de la temperatura, con puntos `estimated` parecidos al modelo actual | §5.3.5 pasa a "hacer ahora" (no espera datos de sombra) |
| D5 | 2026-09-26 | **Sport = +8 % sobre la velocidad típica, con tope en el límite legal y en la curva** (lo que ya hace el código) | Sin cambios de código; el ADR-0012 pasa de propuesta a decisión |
| D6 | 2026-09-26 | **Verificar la pasada 2 solo al compartir** un viaje, no al guardarlo | §5.6.1: la verificación va en `shareTripFn`, no en `saveTripFn`. El viaje guardado sin compartir muestra el plan de la pasada 1 |
| D7 | 2026-09-26 | **Conservar `RoutePlan` ampliado** como contrato definitivo (con `dataQuality`, supuestos, `modelVersion` y `snapshotId`); no se crea `EVRoutePlan` ni `legacy-adapter.ts` | §5.10 paso 1 queda fijado; se escribe el ADR en F9 |
| D8 | 2026-09-26 | **Tope por tipo de vía cuando no hay límite:** primaria 90, secundaria 80, terciaria 60, local/urbana 50, sin pavimentar 40 km/h; fuente `configurable`, ajustable en `ModelParameters.speed.defaultByRoadTier` | §5.3.4 tiene los valores; sigue pendiente confirmar contra la normativa vigente al implementarlo |
| D9 | 2026-09-26 | **Blaze solo para electrolineras:** un endpoint con el listado y otro con el detalle de cada una, que se pide solo para las estaciones usadas en la ruta cuando haga falta. Rutas, elevación, clima, geocodificación y vehículos siguen con los proveedores actuales | §5.7 se reduce a `BlazeStationCatalog` (listado) y un puerto de detalle; ya no hacen falta `VehicleCatalog` ni adaptadores de rutas o clima. Falta el formato exacto de los dos endpoints (O5) |
| D10 | 2026-09-26 | **Merge commit** para unir `engine-v2` a `main` | Se conserva un commit por fase; §5.10 paso 10 usa merge commit |
| D13 | 2026-09-26 | **"¿Con cuánto llegaste?" en Mis viajes**: el usuario anota el SOC de llegada (y opcionalmente el de salida) de un viaje de su cuenta; se guarda en `voltia_trip_observations` y se compara con el plan | §5.8 implementado (ADR-0014); aplicar la migración 0014 (O8) |
| D12 | 2026-09-26 | **Caché de elevación por el máximo tiempo posible** (pedido: "en cookies"). Se implementó en el servidor, sin vencimiento: la Data Cache de Next con `revalidate: false`, que persiste entre peticiones y despliegues y es compartida por todos los usuarios. Las cookies no sirven: ~4 KB cada una frente a ~100–150 KB por tesela, viajan en cada petición y el navegador no consulta la elevación (lo hace el servidor) | Teselas de Mapbox y consultas de Open-Meteo sin vencimiento (`CACHE_FOREVER` en `http.ts`). Los viajes guardados ya llevan la elevación en su snapshot |
| D11 | 2026-09-26 | **Espera en estación ocupada: 15 min (estimado)** hasta tener datos | Cuando el detalle de Blaze dé estado por conector, se revisa (p. ej. sin espera si hay otro conector compatible libre) |

**Todas las decisiones (D1–D13) están tomadas.** Lo que queda abierto depende de datos o de acciones: el tileset y el costo de Mapbox (O4, O6), el cierre del periodo de sombra (O3 → D2), cuándo activar la energía v2 (el dueño, D3) y el formato de los endpoints de Blaze (O5).

## 4. Tareas operativas (sin código)

Se hacen en Supabase, Vercel o en tu computador. Varias desbloquean fases.

### O1 · Rotar la contraseña de la base (urgente)
Pasó por el chat.
1. En Supabase: *Project Settings → Database → Reset database password*.
2. Actualizar `DATABASE_URL` y `DIRECT_URL` en `.env.local`, en la configuración del entorno de Claude Code y en Vercel (Production y Preview).
3. Redesplegar en Vercel y comprobar `GET /api/health`.

### O2 · Variables en la configuración del entorno de Claude Code
Menú del entorno en la barra de título de la sesión → *Edit* → variables. Copiar las de `.env.local` que hagan falta. Nunca en el repo.

### O3 · Modo sombra en producción
1. En Vercel, agregar `PLANNER_ENGINE=shadow` y `ENERGY_ENGINE=shadow` (Production).
2. Redesplegar.
3. Durante 1–2 semanas, filtrar los logs por `[plan-trip:shadow]` y `[plan-trip:energy-shadow]`. En producción son JSON de una línea, y cada línea es un viaje.
4. Revisar sobre todo:
   - viajes donde cambia la viabilidad o la ruta elegida (`selected`);
   - diferencias de energía fuera del rango de D3;
   - rutas de montaña (Bucaramanga, Bogotá, Medellín, Manizales);
   - la línea `[elevation]`: fuente, puntos, tiempo y desnivel.
5. Resumir en un comentario del ADR-0007 y del ADR-0012 cuántos viajes, cuántos distintos y por qué.

El costo es tiempo de CPU: cada planificación calcula dos veces. No hay llamadas extra a proveedores.

### O4 · Comparar las fuentes de elevación — ✅ primera corrida 2026-09-26
Resultado en `mediciones/elevacion-2026-09-26.md`: el tileset responde, la caché deja la segunda corrida en 0 consultas y una ruta nueva de 421 km pide 49 teselas. Ruta de llano (Villavicencio → Puerto López, 2026-09-27): Mapbox no infla el desnivel (7 m en 84 km) y `open-meteo-adaptive` ya corre sin respaldo. Queda opcional repetir la ruta de montaña para la fila adaptativa y contrastar su subida con una referencia externa.

En tu computador, con `.env.local`:
```bash
git pull origin engine-v2
npm install
npm run elevation:compare
ORIGIN=7.1193,-73.1227 DESTINATION=4.711,-74.0721 npm run elevation:compare   # Bucaramanga → Bogotá
```
En PowerShell: `$env:ORIGIN="7.1193,-73.1227"; $env:DESTINATION="4.711,-74.0721"; npm run elevation:compare`.

Guardar las tablas en `docs/arquitectura-ev/mediciones/elevacion-AAAA-MM-DD.md`. Si `mapbox-terrain` falla con 404 o 401 por el nombre de la capa, cambiar `ModelParameters.elevation.terrain.tileset` a `mapbox.mapbox-terrain-dem-v1` y repetir. Esto decide D1.

### O5 · Blaze: key y prueba — documentación ✅ (`docs/blaze/api-publica-v1.md`)
1. **Key:** poner `BLAZE_API_KEY=blz_…` en `.env.local`, nunca en el chat ni en el repo. Pedirla con los scopes `stations:read`, `location:read`, `connectors:read`, `chargers:read` y `operators:read`.
2. **Prueba:** `npm run blaze:check`. Sirve para revisar que lleguen coordenadas y conectores, qué etiquetas de conector usa Blaze y el detalle de una estación.
3. **Local:** con la key puesta, la app ya usa Blaze. Para volver al dataset: `DATA_SOURCE=legacy`.
4. **Producción:** en Vercel, `BLAZE_API_KEY` en Production (y `DATA_SOURCE=blaze` si se quiere explícito).

### O6 · Plan de Mapbox
Confirmar el cupo mensual de Directions, Matrix (§5.2) y teselas raster (terreno). Anotar los números en el ADR-0011. Dato medido (O4): ~12 teselas por cada 100 km de ruta **nueva**; las repetidas no cuestan por la caché sin vencimiento.

### O9 · Probar v1 y v2 desde la app
Desde 2026-09-27 el selector está abierto a todos, invitados incluidos (`ENGINE_PREVIEW_EMAILS=*`). En el planificador aparece "Motor de cálculo (vista previa)" con **v1 | v2**. v2 usa el planificador nuevo y la energía física; si ya hay una ruta, cambiar el motor la recalcula. La elección se guarda en el navegador. Para volver a limitarlo: `ENGINE_PREVIEW_EMAILS` con una lista de correos en Vercel. **Si en Vercel quedó `ENGINE_PREVIEW_EMAILS=w1andresv@gmail.com`, hay que borrarla o poner `*`**, porque el valor del entorno manda sobre el valor por defecto.

### O8 · Aplicar la migración 0014 (calibración)
`npm run db:migrate` en tu computador (con `.env.local`). Crea la tabla `voltia_trip_observations` y su seguridad por fila, y **escribe en el esquema de producción**. Hasta que se aplique, el botón "¿Con cuánto llegaste?" muestra un error al guardar; el resto de la app no cambia. Para ver los resultados: `npm run calibration:report`.

### O7 · Seed del catálogo (cuando se quiera)
`npm run db:seed` **escribe en producción**: solo cuando haya cambios del catálogo que se quieran publicar (por ejemplo, parámetros físicos por vehículo de §5.3.6).

---

## 5. Pendientes de código, por fase

Cada pendiente sigue el mismo formato: **Contexto → Pasos → Archivos → Tests → Cierre → Depende de**.

### 5.1 F2b · Elevación

> **Sesión B (2026-09-26):**
> - **Fuente por defecto:** `ELEVATION_SOURCE` es `mapbox-terrain` (sin token de Mapbox cae a Open-Meteo), y el fetch sintético sirve teselas terrain-RGB.
> - **Caché (D12):** teselas de Mapbox y elevación de Open-Meteo sin vencimiento (`CACHE_FOREVER`).
> - **Túneles:** salen de `intersections[].classes` de Mapbox (`RawRoute.structures`); dentro de un túnel la altura es la recta entre sus extremos.
> - **Pendiente máxima:** 15 % entre puntos del perfil denso (`ModelParameters.elevation.maxGradePct`); `elevation.correctedPoints` cuenta los puntos corregidos.
> - **Sin elevación:** `dataQuality.elevation = "unavailable"` más un aviso claro (`ELEVATION_UNAVAILABLE_TEXT`); el plan no se bloquea.
> - **Verificar al compartir:** `shareTripFn` llama a `verifySnapshot` (máximo 8 s, nunca bloquea) y guarda `snapshot.verifiedRoutes`. `/v/[shareId]` usa `computePlansFromSnapshot`.
>
> Con los datos sintéticos, cambiar a `mapbox-terrain` movió la energía unas décimas de kWh. En montaña real la diferencia será mayor.

#### 5.1.1 Elegir la fuente por defecto — ✅ hecho (sesión B: `mapbox-terrain`, D1)
- **Contexto:** hoy `ELEVATION_SOURCE` es configurable y por defecto `open-meteo` (96 puntos por ruta). Hay que elegir con datos (D1, O4).
- **Pasos:**
  1. Correr O4 en al menos dos rutas de montaña y una de llano.
  2. Si gana `mapbox-terrain` o `open-meteo-adaptive`, cambiar el `.default(...)` de `ELEVATION_SOURCE` en `src/infrastructure/config/env.ts` y el comentario de `.env.example`.
  3. Actualizar el ADR-0011 (estado "aceptada con fuente X", números medidos).
  4. Actualizar la caracterización: `src/test-support/characterization.test.ts` usa la fuente por defecto con el fetch sintético. `mapbox-terrain` necesita que `syntheticFetch` sirva teselas; ver el punto siguiente.
- **Archivos:** `src/infrastructure/config/env.ts`, `.env.example`, `docs/adr/0011-…`, `src/test-support/synthetic-providers.ts` (si cambia la fuente por defecto).
- **Tests:** si el valor por defecto pasa a `mapbox-terrain`, agregar a `syntheticFetch` una respuesta para `api.mapbox.com/v4/*/{z}/{x}/{y}.pngraw` con `encodePng` (`src/test-support/png-encoder.ts`), usando la misma función `elevationAt(lat, lon)` que ya usa el Open-Meteo sintético. Regenerar los snapshots con `-u` y explicar el cambio en el commit.
- **Cierre:** la fuente está elegida, el ADR actualizado y CI en verde.
- **Depende de:** O4, D1.

#### 5.1.2 Túneles y puentes en `ProviderRoute` — ✅ túneles hechos (sesión B); Mapbox no marca puentes: los cubre la pendiente máxima
- **Contexto:** el modelo de terreno (DEM) da la altura del **terreno**, no de la vía. En un túnel "sube la montaña" y en un puente "baja al río". Hay que saber qué tramos son túnel o puente para limpiarlos.
- **Pasos:**
  1. Revisar en una respuesta real de Mapbox Directions (con `steps=true`) cómo vienen los túneles. Normalmente es `intersections[].classes` con `"tunnel"`. Revisar también si vienen puentes: Mapbox no siempre los marca. Guardar un ejemplo recortado, **sin token**, en `src/test-support/fixtures/mapbox-tunnel.json`.
  2. Ampliar el esquema zod de `src/infrastructure/providers/routing.osrm.ts` (lo comparten Mapbox y OSRM) con `intersections[].classes: z.array(z.string()).optional()`.
  3. En `toProviderRoute` (`src/infrastructure/providers/adapters.ts`), pasar a `ProviderStep` un nuevo campo `structures?: { kind: "tunnel" | "bridge"; fromM: number; toM: number }[]`, o marcar la intersección con `classes`.
  4. En `src/domain/ev/contracts/route.ts`, documentar el campo nuevo.
  5. En `src/domain/ev/engines/route/normalize.ts`, calcular los tramos de estructura en km de la ruta y dejarlos en `RawRoute` como `structures?: { kind; fromKm; toKm }[]`. Agregarlos al esquema del snapshot (`src/domain/ev/contracts/snapshot.ts`) como opcionales.
- **Tests:** normalización con el fixture (km de inicio y fin del túnel), adaptador con `classes`, y un snapshot viejo sin `structures` que sigue siendo válido.
- **Cierre:** una ruta con túnel llega al dominio con su tramo marcado.

#### 5.1.3 Limpieza de la elevación y pendiente máxima — ✅ hecho (sesión B)
- **Contexto:** con los tramos marcados, la elevación dentro de un túnel o puente se reemplaza por una recta entre sus extremos. Además se limitan las pendientes imposibles (errores del DEM).
- **Pasos:**
  1. En `src/domain/ev/engines/elevation/engine.ts`, nueva función pura `cleanElevationProfile(probes, heights, structures, params)` que:
     - interpola linealmente la altura entre la entrada y la salida de cada estructura;
     - limita la pendiente entre puntos consecutivos a `params.elevation.maxGradePct` (propuesta: 15 %, `estimated`; carreteras colombianas de montaña rara vez pasan de 12–14 %) recortando el punto que la viola;
     - devuelve también cuántos puntos corrigió (`corrected`).
  2. Llamarla en `applyDenseElevationProfile` y `applyElevationProfile` **solo** si hay `structures` o si la pendiente máxima se supera. Con los datos actuales sin estructuras, la estrategia fija no debe cambiar resultados: comprobarlo con la caracterización.
  3. Agregar `maxGradePct` a `ModelParameters.elevation`.
  4. Reportar `corrected` en el log `[elevation]` y en `RawRoute.elevation.correctedPoints` (opcional).
- **Tests:** un túnel (perfil con una montaña encima → recta), un puente (valle → recta), un pico de DEM (pendiente del 40 % → recortada), y ninguna corrección sin estructuras ni picos (resultado idéntico).
- **Cierre:** tests en verde; en la caracterización, cambios solo si hay estructuras.

#### 5.1.4 Error tipado `ELEVATION_UNAVAILABLE` — ✅ hecho (sesión B: aviso y `dataQuality`, sin bloquear el plan)
- **Contexto:** hoy, si ninguna fuente responde, la ruta queda plana y se agrega un aviso. La especificación pide un error de datos explícito (no un estado de viabilidad).
- **Pasos:**
  1. En `src/application/plan-trip/elevation-profile.ts`, cuando todo falla, devolver `report.source = null` (ya pasa) y además `report.errorCode = "ELEVATION_UNAVAILABLE"`.
  2. En `src/application/plan-trip/service.ts`, si alguna ruta queda sin elevación y mide más de 5 km:
     - agregar a la respuesta `dataQuality: { elevation: "unavailable" }` (nuevo campo en `GeoBundle` / snapshot, opcional);
     - mantener el aviso de texto;
     - con `PLANNER_ENGINE=v2`, marcar los planes con `feasible: false` e `infeasibilityCode: "DATA_ELEVATION_UNAVAILABLE"`, con su texto en `INFEASIBILITY_TEXT`: "No se pudo obtener la elevación; en montaña el consumo sería poco confiable". Otra opción es solo advertir: decidirlo en el ADR. La recomendación es advertir fuerte y no bloquear.
  3. La UI (`src/components/planner/trip-panel.tsx`) muestra el aviso destacado cuando `dataQuality.elevation === "unavailable"`.
- **Tests:** servicio con un proveedor de elevación que siempre falla, y un snapshot viejo sin `dataQuality`.
- **Cierre:** el caso "sin elevación" es visible y distinguible de "ruta plana de verdad".

#### 5.1.5 Verificar el tileset de Mapbox — ✅ `mapbox.terrain-rgb` responde (O4, 2026-09-26)
Ver O4. Si hay que cambiarlo: `ModelParameters.elevation.terrain.tileset`. La fórmula terrain-RGB es la misma.

---

### 5.2 F4 · Desvíos medidos con la matriz de Mapbox — ✅ hecho detrás de `DETOUR_SOURCE=matrix` (ADR-0013)

> **Sesión D (2026-09-26):**
> - **Piezas:** `DistanceMatrixProvider`, `MapboxMatrixProvider` y `plan-trip/detours.ts`; se miden hasta 24 estaciones compatibles por ruta, en pares de ida y vuelta.
> - **Snapshot y corredor:** `snapshot.detours` guarda los desvíos y `placeOnRoute` usa el medido (`detourSource: "calculated"`).
> - **Por defecto:** `estimated`, sin consultas.
> - **Antes de activarlo:** revisar el cupo (O6) y verificar el límite de coordenadas con un token real.


- **Contexto:**
  - **Hoy:** el desvío a una estación es `2 × distancia en línea recta × detourRoadFactor (1, estimado)`.
  - **Pasada 2:** mide el desvío real del **plan recomendado** (con `v2`), pero no el de las demás estaciones candidatas.
  - **Objetivo de la especificación:** desvíos `calculated` con distancias por vía.
- **Pasos:**
  1. **Puerto nuevo** `src/domain/ports/distance-matrix.ts`: `DistanceMatrixProvider.matrix(sources: LatLon[], destinations: LatLon[]) → { distanceM: (number|null)[][]; durationS: (number|null)[][] }`.
  2. **Adaptador** `MapboxMatrixProvider` en `src/infrastructure/providers/`:
     - llama a `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/{coords}?sources=…&destinations=…&annotations=distance,duration`;
     - **verificar los límites vigentes** de coordenadas por consulta (del orden de 25; menos con `driving-traffic`) y partir en lotes;
     - caché con `fetchJson` y `cacheTtlMs` de 7 días (las vías no cambian seguido).
  3. **Aplicación** `src/application/plan-trip/detours.ts`:
     - para cada estación del corredor, tomar su punto de proyección sobre la ruta (`projectOnRoute`, `engines/corridor`) como origen y la estación como destino;
     - pedir ida (proyección → estación) y vuelta (estación → proyección);
     - si hay muchas estaciones, limitar a las N más cercanas por tramo (parámetro `corridor.maxMatrixStations`, p. ej. 40) para cuidar el cupo.
  4. **Snapshot:** guardar el resultado en el campo `detours?: Record<stationId, { distanceKm; durationMin; source: "calculated" }>`, que el plan §3.2 ya prevé. Agregarlo al esquema zod (`contracts/snapshot.ts`) como opcional.
  5. **Dominio:** `placeOnRoute` (`src/domain/ev/engines/corridor/engine.ts`) recibe `detours` opcional. Si hay dato para la estación, usa la distancia y la duración reales (`detourSource: "calculated"`); si no, la estimación actual.
  6. **Energía del desvío:** con la distancia real, ver §5.3.3.
  7. **Activación:** detrás de una variable `DETOUR_SOURCE = estimated | matrix`, por defecto `estimated`, igual que las demás.
- **Tests:** adaptador con respuesta grabada (fixture sin token); `placeOnRoute` con y sin `detours`; servicio con un `DistanceMatrixProvider` falso; la caracterización no cambia con `estimated`.
- **Cierre:** con `matrix`, cada parada muestra el desvío real; el log dice cuántas consultas de matriz hizo.
- **Depende de:** O6 (cupo de Mapbox).

---

### 5.3 F5 · Energía v2: lo que falta

#### 5.3.1 Medir en sombra
Ver O3. Lo que se mira: energía, kWh/100 km, tiempo de manejo frente al del proveedor, SOC de llegada y mínimo, paradas. Las diferencias grandes se explican antes de F6 (D3).

> **Sesión A (2026-09-26):** 5.3.2 a 5.3.5 quedaron hechos detrás de `ENERGY_ENGINE`, sin cambios con `legacy`.
> - Puntos intermedios: `RawRoute.legBoundariesKm`, y el perfil se detiene ahí (también en la pasada 2, donde las estaciones son puntos intermedios).
> - Desvío: consumo local ±2 km más el costo de parar y arrancar (`detourEnergyV2`), inyectado en los dos planificadores.
> - Tope por clase vial: `roadTier` por muestra y `ModelParameters.speed.defaultByRoadTier` (D8).
> - Frío: `ModelParameters.energy.temperatureFactor` sobre la tracción (D4).
>
> En la ruta sintética: +0,1 kWh y −0,2 puntos de SOC al llegar a la parada, por el costo de parar. Los pasos de abajo quedan como referencia de lo implementado.

#### 5.3.2 0 km/h en los puntos intermedios del usuario y en las paradas de carga — ✅ hecho (sesión A)
- **Contexto:** el perfil de velocidad arranca y termina en 0, pero no se detiene en los puntos intermedios. En la pasada 2 las estaciones son puntos intermedios, así que tampoco se detiene en ellas. La razón es que `RawRoute` no guarda dónde termina cada tramo (*leg*).
- **Pasos:**
  1. En `toRawRoute` (`src/domain/ev/engines/route/normalize.ts`), calcular `legBoundariesKm: number[]` con `legBoundariesKm(route)` (ya existe en `engines/route/classify.ts`; moverla a `normalize.ts` o a `core/axis.ts` para no cruzar engines), escalados a `distanceKm`.
  2. Agregar `legBoundariesKm?: number[]` a `RawRoute` (`src/domain/types.ts`) y al esquema del snapshot como opcional.
  3. En `speedMesh` (`src/domain/ev/engines/speed/engine.ts`), incluir esos km en la malla y marcarlos con `stop: true`.
  4. En `buildSpeedProfile`, antes de las pasadas, poner `v = 0` y `limitingFactor = "stop"` en los puntos con `stop: true`.
  5. **Paradas de la pasada 1** (antes de saber dónde se para): no se puede usar el perfil. En su lugar, sumar a cada parada un evento de energía de "frenar y volver a arrancar", `½·m_eff·v²/η − recuperación del frenado`, con la `v` del perfil en ese km. Va en `stopEvents` (`src/domain/planner.ts`) solo con `energyEngine === "v2"`.
- **Tests:** perfil con un punto intermedio (0 km/h en ese km, aceleración antes y después); energía de una ruta con un punto intermedio > sin él; `stopEvents` con v2 suma el evento.
- **Cierre:** en la pasada 2, cada estación aparece como parada con 0 km/h.

#### 5.3.3 Energía del desvío con el perfil (especificación §5.8.1) — ✅ hecho (sesión A)
- **Contexto:** hoy el desvío usa el modelo anterior a 50 km/h en llano (`segmentEnergyKwh` en `src/domain/planner.ts`, dos lugares: la función que coloca cargadores y `planStopsV2`).
- **Pasos:**
  1. Nueva función pura `localNetRateKwhPerKm(samples, km, windowKm = 2)` en `src/domain/ev/engines/chart/series.ts` o en un módulo nuevo `engines/energy/local-rate.ts`: la energía neta de la ventana ±2 km dividida por su distancia (con prorrateo, como `consumptionWindows`).
  2. Con `energyEngine === "v2"`: `detourEnergyKwh = detourKm × max(0, localNetRate)`, marcado `estimated` (o `calculated` si el desvío vino de la matriz, §5.2).
  3. Pasar `energyEngine` a las funciones del planificador que calculan el desvío.
- **Tests:** la tasa local en llano es igual al consumo por km; en bajada no es negativa; la energía del desvío con v2 no depende de `STYLE_MULT`.

#### 5.3.4 Velocidad por clase vial cuando no hay límite — ✅ hecho (sesión A)
- **Contexto:** la especificación dice `v_exp = min(límite ?? defaultByRoadClass, típica)`. Hoy, sin límite, solo cuenta la típica del proveedor.
- **Pasos:**
  1. En `ModelParameters.speed`, agregar `defaultByRoadTier: SourcedValue<Record<RoadTier, number>>` con los valores de D8: primaria 90, secundaria 80, terciaria 60, local/urbana 50, sin pavimentar 40 km/h; fuente `configurable` y referencia a la norma cuando se confirme. La clase `unknown` no tiene tope.
  2. En `toRawRoute`, asignar a cada muestra su `roadTier` con la clasificación de `engines/route/classify.ts`. Moverla o compartirla por `core/` para no cruzar engines. Campo opcional `roadTier?` en las muestras y en el esquema del snapshot.
  3. En `speedMesh`/`buildSpeedProfile`, si no hay `limitKmh`, usar `defaultByRoadTier[roadTier]` como tope, con `limitingFactor = "road_class_default"` (agregarlo a `LimitingFactor` en `contracts/speed.ts`).
- **Tests:** sin límite y con clase terciaria, el tope es el de la tabla; con límite, manda el límite.

#### 5.3.5 Temperatura (D4) — ✅ hecho (sesión A)
**Decidido (D4): se hace ya.** Se agrega un `EfficiencyModel` en `engines/energy/`: la eficiencia del tren motriz como función de la temperatura, con puntos `estimated` y la extensión que prevé la especificación §5.4. Se usa en `segmentEnergyV2` en vez de `drivetrainEfficiency` constante. Tests: a 20 °C, el mismo resultado que hoy; a 5 °C, menos eficiencia.

#### 5.3.6 Parámetros físicos por vehículo en el catálogo — 🟡 Cd·A y regeneración cargados (2026-09-27); falta publicarlos con `npm run db:seed`

> **2026-09-27:** fuentes en `seeds/0001_vehicle_catalog.sql` (líneas `física`).
> - **Cd·A:** para cada vehículo, Cd publicado × área frontal estimada (0,85 × ancho × alto).
>   - MG S5: 0,70 (Cd 0,27–0,28);
>   - Model 3: 0,50 (Cd 0,219);
>   - Model Y: 0,58 (Cd 0,22);
>   - EX30: 0,68 (Cd 0,28).
> - **Regeneración máxima:**
>   - Model 3: 75 kW, medida por usuarios;
>   - Model Y: 75 kW, asumido del Model 3;
>   - MG S5 y EX30: 60 kW, asumido.
> - **Sin cargar:** Crr, eficiencias, inercia y auxiliares. Nadie los publica, y copiarlos los haría pasar por dato del vehículo; siguen como `estimated` hasta que haya calibración (§5.8).
> - **Para publicarlos:** `npm run db:seed`, que escribe en producción.


> Revisado en la sesión D: los Cd se publican (p. ej. Tesla Model 3 actualizado, 0,219), pero el área frontal y las eficiencias casi nunca vienen del fabricante; solo hay estimaciones de terceros. Para no meter cifras sin fuente, queda como tarea de datos. Hay que conseguir la ficha o prueba publicada de cada vehículo (`mg-s5-ev-comfort`, `mg-s5-ev-deluxe`, `tesla-model-3-lr-awd`, `tesla-model-y-rwd`, `tesla-model-y-lr-awd`, `volvo-ex30-sm-er`) y registrar cada cifra con su referencia. La calibración (§5.8) es la otra vía.

- **Contexto:** el esquema ya acepta `drivetrainEfficiency`, `regenEfficiency`, `maxRegenPowerKw`, `rotationalInertiaFactor` y `baseAuxPowerKw`; ningún vehículo los trae y todos usan los valores por defecto `estimated`.
- **Pasos:**
  1. Buscar datos con fuente (fichas del fabricante, EPA para los Tesla, pruebas publicadas). Registrar cada cifra con su referencia en `docs/catalogo-pendientes.md`.
  2. Agregarlas al JSON de cada vehículo en `seeds/0001_vehicle_catalog.sql` y al respaldo de `src/domain/vehicles.ts`. El test `seeds.test.ts` compara ambos.
  3. `npm run db:seed` cuando se quiera publicar (O7).
- **Cierre:** la tarjeta de estadísticas deja de listar como "estimados" los parámetros que ya tienen fuente.

---

### 5.4 F6 · Quitar los multiplicadores

- **Contexto:** el modelo anterior (`src/domain/energy.ts`) sigue vivo porque `ENERGY_ENGINE=legacy` es el valor por defecto. Por D3, **el dueño del producto decide cuándo activar la energía v2** con `ENERGY_ENGINE`, y F6 empieza solo cuando lo pida explícitamente.
- **Pasos:**
  1. Cambiar el valor por defecto de `ENERGY_ENGINE` a `v2` (`src/infrastructure/config/env.ts`) y observar una semana.
  2. **Lo que usa el modelo anterior fuera del planificador:**
     - `batteryBudget` y `mixedCycleKwhPer100` (`src/components/planner/battery-panel.tsx`, `vehicle-editor.tsx`): reemplazarlos por una función v2, `referenceConsumptionKwhPer100(vehicle, conditions, weather)` en `src/domain/ev/energy-v2.ts`, que calcula 100 km en llano a 70 km/h con `segmentEnergyV2`.
     - `wltpKwhPer100`, `energyMode`, `hasManualConsumption`: son utilidades sin multiplicadores; moverlas a `src/domain/ev/engines/energy/` o dejarlas.
  3. **En `src/domain/planner.ts`:**
     - quitar `STYLE_SPEED_FACTOR` y `driveMinutesFor` (el tiempo sale del perfil);
     - quitar la rama `annotateEnergy`: la energía siempre es `energyProfileForRoute`;
     - quitar el parámetro `energyEngine` o dejarlo solo con `"v2"`.
  4. **Borrar de `src/domain/energy.ts`:** `STYLE_MULT`, `STYLE_SPEED_FACTOR`, `CYCLE_OVERHEAD`, `REGEN_RECOVERY`, `REGEN_POWER_SHARE`, `CLIMATE_POINTS`/`climateMultiplier`, `drivetrainEff` (usa `motorKw`), `manualSpeedFactor`, `MANUAL_AERO_SHARE`, `physicsSlice`, `manualSlice`, `segmentEnergyBreakdown`, `segmentEnergyKwh` y `annotateEnergy`. Lo que queda (entorno, tipos) ya vive en `engines/energy/`.
  5. **Borrar** `ENERGY_ENGINE`, `energyMode` del servicio, `logEnergyShadow` y `energy-shadow-report.ts`. `geo.energyEngine` queda para leer snapshots viejos: un snapshot con `"legacy"` se recalcula con v2 y la página lo dice.
  6. **Tests:**
     - `src/domain/energy.test.ts` se borra o se reescribe contra v2;
     - `src/domain/planner.test.ts` tiene expectativas numéricas del modelo anterior: revisarlas una por una y documentar el cambio en el commit;
     - la caracterización: los escenarios `legacy` pasan a ser los de v2 (regenerar con `-u` y explicar).
  7. `modelVersion` en `ModelParameters` pasa a `"1.0.0"` (cambian resultados).
- **Comprobación de cierre (especificación y plan):**
  ```bash
  grep -rn "STYLE_MULT\|STYLE_SPEED_FACTOR\|CYCLE_OVERHEAD\|climateMultiplier\|REGEN_POWER_SHARE\|motorKw" src/domain
  ```
  No debe quedar ningún uso en el cálculo (`motorKw` puede seguir en el esquema como dato informativo).
- **Depende de:** D3, O3 y §5.3.1.

---

### 5.5 F7 · Planificador v2: lo que falta

1. **Medir en sombra (O3):** revisar `[plan-trip:shadow]` y decidir D2.
2. **Activar:** cambiar el valor por defecto de `PLANNER_ENGINE` a `v2` en `src/infrastructure/config/env.ts` (o solo en Vercel primero). Con `v2` se activa también la pasada 2 (ADR-0009): vigilar el log `[plan-trip:verify]` (cuántas veces queda `failed`) y el cupo de Mapbox.
3. **Calibrar la espera en estaciones ocupadas** (D11) cuando haya datos de ocupación (Blaze, §5.7).
4. **Borrar el planificador anterior** en F9 (§5.10).

---

### 5.6 F8 · Pasada 2 al guardar y compartir; activar v2

#### 5.6.1 Verificar al compartir (D6) — ✅ hecho (sesión B)
- **Contexto:** la pasada 2 solo corre al planificar con `v2`. Un viaje guardado conserva los datos de la pasada 1 (ADR-0010). Por D6, se verifica **al compartir**: el link público muestra el plan verificado; guardar no gasta consultas extra.
- **Pasos:**
  1. En `EVRoutePlanningService` (`src/application/plan-trip/service.ts`), nuevo método `verify(snapshot, planId, request)`:
     - arma `PlanInputs` desde el snapshot;
     - elige el plan con `computePlans`;
     - llama a `verifyPlan` (`verify-plan.ts`);
     - devuelve el plan verificado **y** la ruta real que usó (`RawRoute`).
  2. Guardar en el snapshot un campo nuevo `verifiedRoutes?: Record<planId, RawRoute>`, opcional en el esquema (`contracts/snapshot.ts`).
  3. En la página compartida (`src/app/v/[shareId]/page.tsx`), si hay `verifiedRoutes[planId]`, recalcular ese plan con esa ruta y con `chargers` = solo las estaciones del plan. Así el link muestra el plan verificado.
  4. En `shareTripFn` (`src/server/actions/trips.ts`): si el viaje tiene snapshot y no tiene `verifiedRoutes`, llamar a `createPlanningService().verify(...)` con un tiempo máximo (p. ej. 8 s) y actualizar `payload.snapshot`. Si falla o se pasa del tiempo, se comparte igual, sin verificar. Nunca bloquea el link.
  5. `saveTripFn` no cambia.
- **Tests:** `trips.test.ts` con el servicio simulado (al compartir guarda `verifiedRoutes`; si `verify` falla, comparte igual; guardar no llama a `verify`); la página compartida usa la ruta verificada.
- **Depende de:** nada más (D6 decidida).

#### 5.6.2 `PLANNER_ENGINE=v2`
Ver §5.5.

---

### 5.7 FB · Fuente de datos Blaze (Muvatec) — ✅ implementado detrás de `DATA_SOURCE` (2026-09-27, ADR-0008); falta probar con la key real (`npm run blaze:check`)

El diseño está en el ADR-0008. **Alcance (D9):** Blaze entrega solo electrolineras, con dos endpoints:
- **listado** de todas las estaciones: reemplaza el dataset consolidado de OSM, SIVEEIC, comunidad y catálogo;
- **detalle** de una estación: se pide solo para las estaciones que usa la ruta (paradas propuestas y las que el usuario abre), cuando haga falta.

Rutas, elevación, clima, geocodificación y vehículos siguen con los proveedores actuales.

1. **O5:** la documentación de los dos endpoints en `docs/blaze/`: URL, autenticación, parámetros, paginación, forma de la respuesta, unidades (kW, AC/DC, tipo de conector), frecuencia de actualización y límites de uso. Sin tokens ni datos de clientes.
2. **Correspondencia de campos** (va en el ADR-0008, que pasa a "aceptada"):
   - listado → `ConsolidatedStation`: id, nombre, coordenadas, operador, conectores con estándar, potencia, corriente, cantidad y estado, disponibilidad, precio, dirección;
   - detalle → lo que el listado no trae: estado en vivo por conector, precio vigente, horario, fotos, servicios, etc.
3. **Cliente** `src/infrastructure/blaze/client.ts`:
   - lee `BLAZE_API_URL` y `BLAZE_API_KEY` en `getEnv()` (`src/infrastructure/config/env.ts`);
   - `fetchJson` con timeout, un reintento y caché: **listado** con `cacheTtlMs` del orden de 1 h (ajustar a la frecuencia que declare Blaze); **detalle** corto (1–5 min si trae estado en vivo);
   - la credencial va en la cabecera que indique la documentación y nunca en la URL ni en los logs (usar `safeUrl`).
4. **Esquemas** `src/infrastructure/blaze/schemas.ts`: zod del listado y del detalle, **tal como llegan**, con `.passthrough()` en los objetos que pueden crecer.
5. **Traductores** `src/infrastructure/blaze/mappers.ts`, funciones puras:
   - listado → `ConsolidatedStation[]` y `StationConnector` (`src/domain/stations/model.ts`), con `source: "blaze"` y `powerOrigin`/`currentOrigin` según lo que diga la fuente;
   - detalle → un tipo de dominio `StationDetail` (nuevo, en `src/domain/stations/model.ts`) con lo que el detalle agrega;
   - agregar `"blaze"` al tipo `SourceId`.
6. **Listado:** `BlazeStationCatalog implements StationCatalog` (`getDataset()` arma un `StationDataset` con `version` = la que dé Blaze o un hash del listado). El planificador no cambia: filtra el corredor igual que hoy.
7. **Detalle:**
   - puerto nuevo `src/domain/ports/station-details.ts`: `StationDetails.get(id) → StationDetail | null` y `getMany(ids)`;
   - adaptador `BlazeStationDetails`;
   - **en la planificación** (`service.ts`): después de elegir las paradas del plan recomendado, pedir el detalle **solo** de esas estaciones (en paralelo, con tiempo máximo) y aplicar lo que cambie la decisión. Si una estación resulta `offline` u ocupada, replanificar una vez sin ella o con la espera (`occupiedWaitMin`). Si el detalle no responde, seguir con el listado;
   - **en la UI:** la ficha de una estación (`src/components/planner/charger-facts.tsx` / `station-hub.tsx`) pide el detalle al abrirla, por una acción de servidor nueva `getStationDetailFn(id)` que usa el puerto a través de `container.ts`.
8. **Selección** en `src/application/container.ts`: `DATA_SOURCE = legacy | blaze`, por defecto `legacy`. Con `blaze` y sin credencial, `legacy` más `console.warn`.
9. **Tests:**
   - fixtures grabados del listado y de un detalle **sin secretos** (revisar con `assertNoSecrets` de `src/test-support/cassette.ts`);
   - un test de contrato por traductor;
   - servicio con un `StationDetails` falso: el detalle solo se pide para las paradas, y una parada `offline` provoca replanificar;
   - caracterización con `DATA_SOURCE=blaze` sobre los fixtures (las estaciones cambian; las invariantes no).
10. **ESLint:** nada fuera de `src/infrastructure/` y `container.ts` importa `@/infrastructure/blaze/*`. La regla actual ya lo cubre; verificarlo con un import de prueba.
11. **Limpieza (F9):** con `DATA_SOURCE=blaze` estable, borrar las fuentes que Blaze reemplaza en `src/infrastructure/stations/sources/*`, la fusión (`src/domain/stations/merge.ts`, `src/infrastructure/stations/registry.ts`) y el cron de refresco del dataset, si ya no se usan.

### 5.8 Calibración (`TripObservation`) — ✅ contrato y registro hechos (sesiones D y E, ADR-0014); falta el ajuste automático cuando haya datos

> **Sesión D (2026-09-26):** `src/domain/ev/contracts/calibration.ts` define `TripObservation` y su esquema zod (plan, modelo, vehículo, condiciones y al menos dos SOC observados). También define `compareObservation`, que calcula el error de SOC en cada punto, el error medio y máximo, el error de energía y la razón de consumo observado/predicho. 
>
> **Sesión E (2026-09-26, D13):** "¿Con cuánto llegaste?" en Mis viajes, con la tabla `voltia_trip_observations` (migración 0014), `recordArrivalFn`, `record-arrival.ts` y `npm run calibration:report`. Falta aplicar la migración (O8) y, con suficientes viajes, el ajuste automático de parámetros (paso 3).


- **Contexto:** la especificación §9 define solo el contrato de datos. Casi todos los parámetros físicos son `estimated`; la calibración los vuelve `calculated`.
- **Pasos:**
  1. `src/domain/ev/contracts/calibration.ts` con `TripObservation` (planId, modelVersion, vehicleId, configuración, SOC observado por km, energía observada, velocidades observadas), como en la especificación.
  2. Tabla `voltia_trip_observations` (migración nueva en `migrations/`) y una acción de servidor para que el usuario, al terminar un viaje, cargue el SOC de llegada (y opcionalmente puntos intermedios).
  3. Un script `scripts/calibrate.mjs` (fuera de la app) que ajusta Crr, eficiencias, captura de regeneración y auxiliares por mínimos cuadrados contra las observaciones, y escribe los nuevos valores como `sourced(x, "calculated", { reference: "calibración AAAA-MM, N viajes" })` en `ModelParameters` o por vehículo.
- **Cierre:** el contrato definido (requisito de F9); lo demás puede ir después del paso a `main`.

---

### 5.9 Invariantes e informe de la especificación (§8.4 y §8.5) — ✅ hecho (sesión C)

> **Sesión C (2026-09-26):**
> - **Invariantes:** `src/test-support/invariants.test.ts` comprueba, con el planificador y la energía v2 sobre la ruta sintética: energía (con recorte de regeneración real), balance de SOC (con cargas), masa (1852 kg), determinismo, sanidad sport ≥ normal ≥ eficiente, y que `src/domain/ev` no usa `Math.round` ni `toFixed`. La malla del perfil de velocidad dejó de redondear km.
> - **Informe:** `buildPlanReport` (`src/application/plan-trip/plan-report.ts`) y `npm run report`, que genera `docs/arquitectura-ev/informes/informe-sintetico.md`. Con `REAL=1` (y opcionalmente `ORIGIN`, `DESTINATION`, `STATIONS_URL`) usa Mapbox real. Probado en `src/test-support/report.test.ts`.


Sin la cassette real (P1 omitido), se prueban sobre la ruta **sintética** (`src/test-support/synthetic-providers.ts`).

1. **Test de invariantes:** `src/test-support/invariants.test.ts` con `ENERGY_ENGINE=v2` y `PLANNER_ENGINE=v2`:
   - **Energía:** `Σ energía neta del perfil = energía del plan − regeneración recortada`. Revisar el signo con `regenCurtailedKwh` y sumar los desvíos.
   - **SOC:** `SOC_destino = SOC_0 + (Σ cargas − Σ consumido + Σ regeneración aceptada) / capacidad × 100`.
   - **Masa:** la masa usada es la esperada. La especificación dice 1852 kg para su escenario; en el sintético, calcularla con `tripMassKg`.
   - **Determinismo:** ya existe ("es determinista").
   - **Redondeo:** sin `Math.round` ni `toFixed` en `src/domain/ev/**` salvo presentación. Comprobación estática con un test que lee los archivos y busca esos símbolos, o una regla de ESLint `no-restricted-syntax`.
   - **Sanidad (advertencia):** energía de sport ≥ normal ≥ eficiente.
2. **Informe:** `npm run report` (nuevo script, con la configuración de `vitest.record.config.ts`) que genera `docs/arquitectura-ev/informe-<escenario>.md` con:
   - resumen del plan;
   - tabla de parámetros con fuente (de `VehicleEnergyParams` y `ModelParameters`);
   - paradas;
   - series de consumo por ventana y SOC contra distancia;
   - calidad de datos, avisos y supuestos `estimated`.
- **Cierre:** tests en verde e informe generado.

---

### 5.10 F9 · Limpieza y paso a `main`

**Requisitos previos:** `PLANNER_ENGINE=v2` y `ENERGY_ENGINE=v2` en producción sin problemas (D2, D3), F6 hecha, D7 y D10 decididas.

1. **Contrato del plan (D7, decidido):**
   - `RoutePlan` queda como contrato definitivo, ampliado con lo que le falta de `EVRoutePlan` (`dataQuality`, `assumptions`, `modelVersion`, `snapshotId`). Se documenta en un ADR y no se crea `legacy-adapter.ts`.
2. **Borrar el código anterior:**
   - `planStopsLegacy` y todo lo que solo usa él en `src/domain/planner.ts`: `pickStops`, `assessFirstCharger`, la selección por puntaje y constantes asociadas;
   - `PLANNER_ENGINE`, `logShadow`, `shadow-report.ts` y sus tests;
   - lo que quede de `src/domain/energy.ts` tras F6;
   - `geo.plannerEngine` y `geo.energyEngine` quedan solo para leer snapshots viejos.
3. **Mover lo que queda** de `src/domain/planner.ts` (armado del `RoutePlan`, itinerario, avisos de adaptador) a `src/domain/ev/compute-plan.ts` o a módulos de `src/domain/ev/`. Objetivo: `src/domain/planner.ts` desaparece.
4. **Documentación:**
   - reescribir `docs/calculo-consumo-energia.md` con el modelo v2 (fórmulas de §5.4, perfil de velocidad, parámetros y fuentes);
   - actualizar `README.md` si cita el modelo anterior.
5. **Calibración:** contrato `TripObservation` definido (§5.8).
6. **Cobertura:** ≥ umbrales (80/80/80/70) sobre `src/domain/ev`. Revisar con `npm run test:coverage` y el reporte en `coverage/`.
7. **Invariantes e informe** (§5.9) en verde.
8. **Viajes guardados:** los snapshots con `schemaVersion: 1` siguen siendo válidos. Si F6 o F9 cambian el formato de `RawRoute` (p. ej. `legBoundariesKm`, `roadTier`, `structures`), esos campos son opcionales: no hace falta migrar. Si se sube `SNAPSHOT_SCHEMA_VERSION`, los viajes viejos se recalculan con datos de hoy (ya soportado).
9. **Vercel:** después del paso a `main`, quitar las variables que ya no existen (`PLANNER_ENGINE`, `ENERGY_ENGINE` si se borraron).
10. **PR `engine-v2 → main`:**
    1. `git fetch origin main && git merge origin/main` en `engine-v2`; resolver conflictos (el código de `main` puede haber cambiado en paralelo).
    2. `npm run typecheck && npm run lint && npm run test:coverage && npm run build`.
    3. Abrir el PR con la plantilla del repo si existe. Resumir las fases con sus commits y ADR y el antes y después de números sobre la caracterización.
    4. Revisión y merge con **merge commit** (D10).
    5. Después del merge: el hook de sesión y las reglas de ESLint quedan activos para todas las sesiones.

---

## 6. Orden recomendado y dependencias

```text
Ya (sin esperar a nadie)             Con datos o acciones                         Al final
─────────────────────────            ────────────────────                         ────────
O1 rotar contraseña                  O3 sombra 1–2 semanas ─► PLANNER v2 (D2) ─┐
O3 activar sombra en Vercel          Dueño decide ─► ENERGY v2 (D3) ─► F6 (5.4)│
5.1.1 mapbox-terrain por defecto     O4 verificar tileset y costo (D1)         │
5.1.2–5.1.4 túneles, pendiente,      O5 docs Blaze ─► FB (5.7, alcance D9)     │
            error tipado             O6 plan Mapbox ─► 5.2 matriz              │
5.3.2 0 km/h en tramos               5.3.6 datos físicos por vehículo          ▼
5.3.3 desvío con energía local       5.8 calibración (contrato)           F9 (5.10) ─► PR a main
5.3.4 velocidad por vía (D8)                                                 (merge commit, D10)
5.3.5 efecto del frío (D4)
5.6.1 verificar al compartir (D6)
5.9 invariantes e informe
```

**Secuencia sugerida en sesiones de trabajo:**
1. **Tú, ya:** O1 (contraseña), O3 (sombra en Vercel) y O4 (tileset y costo de Mapbox).
2. **Sesión A (sin red):**
   - 5.3.2 (0 km/h en los tramos);
   - 5.3.3 (desvío con energía local);
   - 5.3.4 (velocidad por tipo de vía, D8);
   - 5.3.5 (frío, D4).

   Mejoran la energía v2 mientras corre la sombra.
3. ~~**Sesión B (sin red, con fixtures):** 5.1.1–5.1.4 y 5.6.1, más la caché sin vencimiento (D12).~~ ✅ Hecha (2026-09-26).
4. ~~**Sesión C:** 5.9 (invariantes e informe).~~ ✅ Hecha (2026-09-26).
5. **Al cerrar la sombra (D2):** `PLANNER_ENGINE=v2`. **Cuando lo decidas (D3):** `ENERGY_ENGINE=v2` y luego F6.
6. **FB** cuando lleguen los dos endpoints de Blaze (O5); puede ir en paralelo desde el paso 3.
7. **F9** y el PR a `main` con merge commit.

---

## 7. Cómo se trabaja cada pendiente

1. **Rama:** directo en `engine-v2` (ADR-0001). `git pull origin engine-v2` antes de empezar.
2. **Leer:** la sección de este documento, la del plan y la de la especificación. Si hay una decisión no cubierta, escribir el ADR **antes** del código (`docs/adr/NNNN-titulo.md`, plantilla en `docs/adr/README.md`) y agregarlo al índice.
3. **Capas** (las comprueba ESLint):
   - `src/domain/**` es puro, sin red, sin Next ni React;
   - un engine no importa otro engine: se comparten tipos por `domain/ev/contracts` y utilidades por `domain/ev/core`;
   - `src/application/**` usa puertos; solo `container.ts` conoce la infraestructura;
   - la UI no importa proveedores.
4. **Todo lo que cambie resultados va detrás de una variable** (`legacy` por defecto) y, si se puede, con modo sombra.
5. **Parámetros:** en `ModelParameters` (`src/domain/ev/core/params.ts`), con `sourced(valor, fuente, { reference, notes })`. Si un cambio altera resultados a propósito, subir `modelVersion`.
6. **Tests primero** donde hay resultado analítico. Sin red: proveedores falsos o fixtures sin secretos.
7. **Caracterización** (`src/test-support/characterization.test.ts`):
   - si un cambio **no** debe alterar resultados, los snapshots no se tocan;
   - si agrega campos, comprobar que la huella sin esos campos es la misma de antes (así se hizo en F5) y regenerar con `-u`;
   - si cambia números a propósito, el commit dice antes y después.
8. **Antes de commitear:** `npm run typecheck && npm run lint && npm test` (y `npm run build` si tocaste la UI o rutas de Next).
9. **Commit** con prefijo de fase (`F2b:`, `F5:`, `F6:`, `FB:`…), qué cambia, qué no cambia y la verificación. Actualizar la tabla de estado del plan 04 en el mismo commit.
10. **Push** a `engine-v2`; revisar que CI quede en verde.

---

## 8. Riesgos y cómo evitarlos

| Riesgo | Señal | Mitigación |
|---|---|---|
| El v2 de energía subestima en montaña o en frío | `[plan-trip:energy-shadow]` con v2 muy por debajo en esas rutas | D4 y §5.3.5 antes de F6; no activar `v2` sin revisar esos casos |
| Costo de Mapbox al activar v2 (pasada 2, terreno, matriz) | Factura o cupo | O6; caché (ya en terreno y rutas); pasada 2 solo del plan recomendado; matriz limitada a N estaciones |
| Open-Meteo sin licencia comercial | Uso comercial de la app | Plan de pago de Open-Meteo o `mapbox-terrain` por defecto |
| Snapshots guardados que no validan tras un cambio | Viajes compartidos que se recalculan con datos de hoy | Campos nuevos siempre opcionales; subir `SNAPSHOT_SCHEMA_VERSION` solo a propósito |
| Paso a `main` con conflictos grandes | `main` cambió mucho | Traer `main` a `engine-v2` seguido (cada 1–2 semanas), no solo al final |
| Secretos en fixtures | Tokens en JSON grabados | `assertNoSecrets` en todo grabador; revisar el diff |
| Cambios de la API de Mapbox (`maxspeed`, `classes`, tilesets) | Campos que llegan vacíos | Esquemas zod con `.optional()`/`.passthrough()`; sin dato, el modelo sigue (límite ausente = sin tope) |
| Regla "sin redondeo en el dominio" rota | Resultados no deterministas entre navegador y servidor | Test estático de §5.9 |

---

## 9. Mapa del código

| Área | Archivos |
|---|---|
| Variables de entorno | `src/infrastructure/config/env.ts`, `.env.example` |
| Composición (único que conoce proveedores) | `src/application/container.ts` |
| Caso de uso | `src/application/plan-trip/service.ts`, `route-selection.ts`, `elevation-profile.ts`, `verify-plan.ts`, `shadow-report.ts`, `energy-shadow-report.ts` |
| Puertos | `src/domain/ports/*.ts` |
| Contratos | `src/domain/ev/contracts/{route,energy,soc,speed,snapshot}.ts` |
| Núcleo | `src/domain/ev/core/{params,provenance,units,trip-config,axis}.ts` |
| Engines | `src/domain/ev/engines/{route,elevation,speed,energy,soc,corridor,compatibility,charging,feasibility,chart}/` |
| Composición pura | `src/domain/ev/compute-plan.ts`, `src/domain/ev/energy-v2.ts` |
| Código anterior (se va en F6/F9) | `src/domain/planner.ts`, `src/domain/energy.ts` |
| Proveedores | `src/infrastructure/providers/{adapters,routing.mapbox,routing.osrm,elevation.openmeteo,elevation.mapbox-terrain,png,http,weather.openmeteo,geocode.photon}.ts` |
| Estaciones | `src/infrastructure/stations/`, `src/domain/stations/` |
| Viajes guardados y compartidos | `src/server/actions/trips.ts`, `src/app/v/[shareId]/page.tsx`, `src/components/trips/` |
| Navegador | `src/lib/store.ts` (recalcula con el mismo motor que el servidor) |
| UI del plan | `src/components/planner/` (`stats.tsx`, `consumption-chart.tsx`, `soc-chart.tsx`, `itinerary.tsx`, `trip-panel.tsx`, …) |
| Tests de apoyo | `src/test-support/` (caracterización, proveedores sintéticos, grabadores, PNG) |
| Decisiones | `docs/adr/0001` … `0012` |
