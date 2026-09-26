# 0001. Rama de integración `engine-v2` con una PR por fase

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: F0

## Contexto
La migración al motor v2 tiene diez fases (F0–F9). Cada una deja la app funcionando, pero hasta F8 el motor nuevo no responde a los usuarios. CI solo corría en `main`.

## Decisión
Las fases se integran en `engine-v2`. Cada fase va en una rama `engine-v2/f<N>-<tema>` con PR hacia `engine-v2`. CI corre en los push y en las PR de `engine-v2`. Al terminar F9 (o antes, si una fase se quiere en producción detrás de `PLANNER_ENGINE`), `engine-v2` entra a `main` por PR.

## Consecuencias
- `main` no recibe trabajo a medias; las correcciones de F0 pueden llegar antes con una PR propia.
- Hay que traer `main` a `engine-v2` con merge cuando cambie, para no acumular conflictos.
