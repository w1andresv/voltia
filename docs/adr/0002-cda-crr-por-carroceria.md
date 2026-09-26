# 0002. Cd·A y Crr por carrocería como valores por defecto (MVP)

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F0

## Contexto
El modelo de energía deducía el área de arrastre (Cd·A) y la rodadura (Crr) del peso y la potencia del motor, lo que la especificación prohíbe. Para un Tesla Model 3 daba Cd·A ≈ 0,73 m², cuando el valor publicado ronda 0,5 m². Ningún vehículo del catálogo tiene hoy esos coeficientes con fuente.

## Decisión
Valores estándar por carrocería (`BODY_TYPE_PHYSICS` en `src/domain/energy.ts`): sedán 0,55 m² / 0,009, SUV compacta 0,75 / 0,009, SUV grande o pickup 0,95 / 0,010. Sin carrocería, SUV compacta. Cada vehículo del catálogo lleva `bodyType`, `dragAreaM2` y `rollingResistance` en su payload, y estos mandan sobre la tabla.

## Consecuencias
- Dentro de una carrocería el Cd·A real varía ±20 %, lo que da unos ±10–15 % de consumo en carretera y menos en montaña, donde domina la gravedad.
- Los valores se ajustan en `seeds/0001_vehicle_catalog.sql` (el seed pisa el payload en cada `npm run db:seed`).
- Fuentes para reemplazarlos: coeficientes de *coast-down* de la EPA, resistencia al avance WLTP del certificado de conformidad europeo, Cd de ficha por área frontal, calibración con viajes reales.
- En F5 pasan a `SourcedValue` con fuente `estimated` hasta tener datos reales, y el margen de energía de planificación puede depender de esa fuente.
