# Registro de decisiones de arquitectura (ADR)

Una decisión por archivo, numerada y corta. La especificación del motor v2 pide un ADR para toda decisión que no cubra (`docs/arquitectura-ev/prompt_ev_route_engine_v2.md`, §0).

| # | Decisión | Estado |
|---|---|---|
| [0001](./0001-rama-de-integracion-engine-v2.md) | Rama de integración `engine-v2` con un commit por fase | Aceptada |
| [0002](./0002-cda-crr-por-carroceria.md) | Cd·A y Crr por carrocería como valores por defecto (MVP) | Aceptada |
| [0003](./0003-reserva-incluye-minimo-del-vehiculo.md) | La reserva de SOC incluye el mínimo recomendado del vehículo | Reemplazada por 0016 |
| [0004](./0004-se-conserva-el-viento.md) | Se conserva el modelo de viento aunque la especificación lo deja fuera de v1 | Aceptada |
| [0005](./0005-puertos-transitorios-en-f1.md) | Puertos transitorios en F1 (rutas y elevación todavía muestreadas) | Cumplida en F2a |
| [0006](./0006-f2-en-dos-partes.md) | F2 en dos partes: estructura ahora, malla de elevación y snapshot después | Aceptada |
| [0007](./0007-planificador-v2-detras-del-flag.md) | El planificador v2 entra detrás de PLANNER_ENGINE | Aceptada |
| [0008](./0008-blaze-fuente-unica-detras-de-puertos.md) | Blaze (Muvatec) como fuente única, detrás de los puertos | Propuesta |
| [0009](./0009-pasada-2-solo-plan-recomendado.md) | Pasada 2: solo el plan recomendado, solo con el planificador v2 | Aceptada |
| [0010](./0010-snapshot-con-rutas-muestreadas.md) | PlanningSnapshot con rutas ya muestreadas, guardado solo en la cuenta | Aceptada |
| [0011](./0011-fuente-de-elevacion-configurable.md) | Fuente de elevación configurable (B6) | Aceptada |
| [0012](./0012-energia-v2-detras-de-energy-engine.md) | Energía v2 (física sin multiplicadores y perfil de velocidad) detrás de ENERGY_ENGINE | Aceptada |
| [0013](./0013-desvios-medidos-con-la-matriz.md) | Desvíos medidos con la matriz de Mapbox, detrás de DETOUR_SOURCE | Aceptada |
| [0014](./0014-calibracion-con-soc-de-llegada.md) | Calibración con el SOC de llegada ("¿Con cuánto llegaste?") | Aceptada |
| [0015](./0015-routeplan-contrato-definitivo.md) | `RoutePlan` ampliado como contrato definitivo del plan | Aceptada |
| [0016](./0016-margen-solo-en-el-viaje.md) | El margen de SOC se define solo en el viaje; el vehículo no tiene mínimo ni tope | Aceptada (destino: ver 0017) |
| [0017](./0017-sin-llegada-minima.md) | Sin "Llegada mínima": el margen de seguridad también es la reserva al destino | Aceptada (v2: ver 0019) |
| [0018](./0018-paradas-que-valen-la-pena.md) | Planificador v2: paradas que valen la pena (sesión mínima y tope estirado) | Aceptada |
| [0019](./0019-margen-flexible.md) | Planificador v2: el margen de seguridad es flexible (unos puntos, con piso) | Aceptada |
| [0020](./0020-planificador-llegadas-separadas.md) | Planificador de cargas: llegadas separadas de los niveles de salida, y plazos | Aceptada |
| [0021](./0021-peajes-como-paradas.md) | Peajes como paradas en el perfil de velocidad | Aceptada (30 s por confirmar) |
| [0022](./0022-via-mojada.md) | Vía mojada: más rodadura y más auxiliares | Aceptada (automática por defecto, por confirmar) |
| [0023](./0023-margen-de-energia.md) | Margen de energía: conectar `planning.energyMarginPercent` | Aceptada |
| [0024](./0024-clima-por-tramo.md) | Clima por tramo y por hora de paso | Aceptada |
| [0025](./0025-eficiencia-segun-la-potencia.md) | Eficiencia del tren motriz según la potencia | Aceptada |
| [0026](./0026-perdidas-de-carga.md) | Pérdidas de carga y una sola función de tiempo de carga | Aceptada (valores por confirmar) |
| [0027](./0027-corredor-contra-la-geometria-fina.md) | Corredor contra la geometría fina de la ruta | Aceptada |

## Plantilla

```markdown
# NNNN. Título en una línea

- Estado: propuesta | aceptada | reemplazada por NNNN
- Fecha: AAAA-MM-DD
- Fase: F<N>

## Contexto
Qué problema hay y qué restricciones aplican.

## Decisión
Qué se decidió, en una o dos frases.

## Consecuencias
Qué cambia, qué se gana, qué se pierde y qué queda pendiente.
```
