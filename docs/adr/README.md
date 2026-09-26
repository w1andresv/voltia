# Registro de decisiones de arquitectura (ADR)

Una decisión por archivo, numerada y corta. La especificación del motor v2 pide un ADR para toda decisión que no cubra (`docs/arquitectura-ev/prompt_ev_route_engine_v2.md`, §0).

| # | Decisión | Estado |
|---|---|---|
| [0001](./0001-rama-de-integracion-engine-v2.md) | Rama de integración `engine-v2` con un commit por fase | Aceptada |
| [0002](./0002-cda-crr-por-carroceria.md) | Cd·A y Crr por carrocería como valores por defecto (MVP) | Aceptada |
| [0003](./0003-reserva-incluye-minimo-del-vehiculo.md) | La reserva de SOC incluye el mínimo recomendado del vehículo | Aceptada |
| [0004](./0004-se-conserva-el-viento.md) | Se conserva el modelo de viento aunque la especificación lo deja fuera de v1 | Aceptada |
| [0005](./0005-puertos-transitorios-en-f1.md) | Puertos transitorios en F1 (rutas y elevación todavía muestreadas) | Cumplida en F2a |
| [0006](./0006-f2-en-dos-partes.md) | F2 en dos partes: estructura ahora, malla de elevación y snapshot después | Aceptada |

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
