# 0001. Rama de integración `engine-v2` con un commit por fase

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F0

## Contexto
La migración al motor v2 tiene diez fases (F0–F9). Cada una deja la app funcionando, pero hasta F8 el motor nuevo no responde a los usuarios. CI solo corría en `main`.

## Decisión
Se trabaja directo en `engine-v2`, con un commit por fase (prefijo `F<N>:`), a pedido del dueño del repo. CI corre en cada push a `engine-v2` (y en PR hacia ella, si alguna vez se usan). Al terminar F9 (o antes, si una fase se quiere en producción detrás de `PLANNER_ENGINE`), `engine-v2` entra a `main` por PR.

## Consecuencias
- `main` no recibe trabajo a medias; las correcciones de F0 pueden llegar antes con una PR propia.
- Cada fase es un punto de la historia fácil de revisar o revertir (`git revert` de un commit).
- No se puede usar `engine-v2/<algo>` como nombre de rama: git no admite una rama `engine-v2` y otra bajo `engine-v2/`.
- Hay que traer `main` a `engine-v2` con merge cuando cambie, para no acumular conflictos.
