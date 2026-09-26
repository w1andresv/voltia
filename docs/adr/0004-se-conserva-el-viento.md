# 0004. Se conserva el modelo de viento aunque la especificación lo deja fuera de v1

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F5

## Contexto
La especificación v2 deja fuera de alcance el viento (§1). El código actual ya lo modela: toma el pronóstico, lo corrige a la altura del carro y lo proyecta sobre el rumbo de cada tramo (`airSpeedSq`, `energy.ts`), y tiene tests.

## Decisión
Se conserva, como hace el plan del repo (§0). En F5 se mueve a `engines/energy/air.ts` con sus parámetros en `ModelParameters`.

## Consecuencias
- El resultado depende del clima grabado en el snapshot. El determinismo se mantiene porque el clima entra por el snapshot.
- Si la calibración muestra que empeora el error, se desactiva con un parámetro, sin borrar código.
