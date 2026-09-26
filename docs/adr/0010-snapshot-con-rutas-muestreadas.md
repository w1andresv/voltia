# 0010. PlanningSnapshot con rutas ya muestreadas, guardado solo en la cuenta

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F8

## Contexto
El plan (§3.2) define un `PlanningSnapshot` con la geometría completa de cada ruta y la elevación cruda, para que el mismo snapshot dé siempre el mismo plan. Hoy la respuesta ya lleva un `GeoBundle` con las rutas muestreadas y la elevación aplicada. Los viajes guardados solo tenían la petición y un resumen, así que abrir un viaje compartido volvía a consultar a Mapbox y Open-Meteo en cada visita y el resultado podía cambiar. Con 4 rutas de 130 km, el `GeoBundle` pesa unos 160 KB en JSON.

## Decisión
- `domain/ev/contracts/snapshot.ts`: `PlanningSnapshot = GeoBundle + { schemaVersion: 1, createdAt, modelVersion, plannerEngine, providers }`. Las rutas van ya muestreadas (`RawRoute`), no crudas: es lo que el planificador usa y pesa menos. Si el muestreo cambia, se sube `SNAPSHOT_SCHEMA_VERSION` y los viajes viejos se recalculan con datos de hoy.
- El servicio devuelve el snapshot como `geo` (reloj inyectable para tests). `parsePlanningSnapshot` valida lo que el planificador lee, con tope de 800 KB, y deja pasar el resto de los campos.
- Los viajes **de la cuenta** guardan el snapshot en `payload.snapshot` y `summary.modelVersion`. Uno inválido o de otra versión se ignora: el viaje sigue valiendo. Los viajes **del invitado** (localStorage) no lo guardan.
- `/v/[shareId]`: con snapshot, el plan se recalcula con `computePlans` sin consultar proveedores, y la página dice de qué fecha son los datos. "Recalcular con los datos de hoy" (`?actualizar=1`) vuelve a pedir todo. Sin snapshot (viajes viejos), como antes.
- El store del navegador no persiste `geo`, así que no hace falta migrarlo (ADR-0006 lo suponía).
- `EVRoutePlan` y `legacy-adapter.ts` pasan a F9: hoy no hay ningún componente que lea `EVRoutePlan`. Crear el tipo y el adaptador solo para volver a `RoutePlan` duplica código sin quitar ninguno. En F9 la UI pasa directo al contrato nuevo.

## Consecuencias
- Un viaje compartido se ve igual que cuando se guardó y no gasta cuota de Mapbox por visita.
- El snapshot lo arma el cliente. El dueño de un viaje podría guardar uno alterado, pero solo afecta su propio link, que dice que son datos guardados y ofrece recalcular.
- La pasada 2 no queda en el snapshot (la ruta verificada no es una de las rutas base): al abrir un viaje guardado se ve el plan de la pasada 1. Verificar al guardar queda pendiente (ADR-0009).
