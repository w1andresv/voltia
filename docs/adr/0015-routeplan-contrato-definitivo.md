# 0015. `RoutePlan` ampliado como contrato definitivo del plan

- Estado: aceptada
- Fecha: 2026-09-29
- Fase: F9, paso 1 (guía 05 §5.10, D7)

## Contexto
La especificación define `EVRoutePlan` como resultado final (§6). La UI, los viajes guardados y los compartidos ya leen `RoutePlan`, que tiene casi todo. El dueño del producto decidió (D7) conservar `RoutePlan` y ampliarlo con lo que le faltaba, en vez de migrar todos los componentes a un tipo nuevo.

## Decisión
- **Sin tipo nuevo:** no se crea `EVRoutePlan` ni `legacy-adapter.ts`. `RoutePlan` (`src/domain/types.ts`) es el contrato.
- **Campos nuevos** (opcionales en el tipo, para leer planes y snapshots viejos; `buildPlan` siempre los llena, salvo `snapshotId`):
  - `modelVersion`: `ModelParameters.modelVersion` con que se calculó;
  - `assumptions`: `{ parameter, value, source, reference? }[]`, los valores `estimated` que pesan en este plan (`src/domain/plan/quality.ts`):
    - los parámetros físicos del vehículo que salieron de los valores por defecto;
    - los modos de regeneración;
    - la conexión en cada parada (si hay paradas);
    - el factor de desvío (si algún desvío no se midió);
    - la espera en estación ocupada (si alguna lo está);
    - con la energía anterior, el propio modelo (`energy.model = legacy`);
  - `dataQuality`:
    - `elevation: "unavailable"` si ninguna fuente respondió;
    - `providerDurationDeviationPct` (energía v2);
    - `estimatedDetours`: paradas con el desvío estimado;
    - `stopsWithAssumedPower`: paradas con potencia por defecto del conector;
  - `snapshotId`: huella estable de los datos del snapshot (`snapshotHash`, el `inputHash` de la especificación). El servidor la guarda en `geo.snapshotId` y la pone en cada plan; al recalcular desde el snapshot (navegador, viajes guardados y compartidos) se conserva.
- **Lo que no se agrega por ahora:**
  - de `dataQuality` de la especificación: cobertura de límites de velocidad y de tráfico, porcentaje de elevación recortada y desviación de distancia del proveedor. No se miden hoy; se agregan cuando haya de dónde sacarlos.
  - `warnings` como códigos: siguen en `geo.warnings` como texto.

## Consecuencias
- Un plan dice con qué modelo y con qué datos se calculó, y qué supuso: los informes y la calibración (ADR-0014) pueden agrupar por `modelVersion` y `snapshotId`.
- La huella no cambia con la fecha, los avisos ni la pasada 2 que se agrega al compartir. Sí cambia con cualquier dato de entrada o con la versión del modelo.
- Los snapshots anteriores no traen `snapshotId`: sus planes quedan sin él.
- La caracterización cambió solo por estos campos. Se comprobó con huellas de claves ordenadas: antes y después son iguales sin ellos.
