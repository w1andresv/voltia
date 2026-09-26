# Motor de rutas EV de Voltia — documentos

Orden sugerido de lectura:

| # | Archivo | Qué contiene |
|---|---|---|
| 1 | `feedback-prompt-original.md` | Revisión del prompt original "Arquitectura definitiva — EV Route Planning Engine": lo que está bien, críticos, importantes y menores. |
| 2 | `prompt_ev_route_engine_v2.md` | Prompt corregido y genérico, listo para pegar en un agente de código. |
| 3 | `01-feedback-codigo-vs-plan.md` | Contraste del repo `w1andresv/voltia` con el prompt v2: lo que está bien, errores verificados (C1–C8), diferencias de diseño (D1–D12) y acoplamiento (A1–A8), con archivo:línea. |
| 4 | `02-plan-arquitectura-modular.md` | Plan reescrito para el repo: capas, reglas de dependencia, puertos, snapshot, engines, migración por fases F0–F9 y caso Piedecuesta → Vélez. |
| 5 | `traspaso-y-proximos-pasos.md` | Estado del branch, cómo recrearlo y subirlo, datos clave, próximos pasos (F0), mensaje para una sesión nueva y scripts para reproducir los hallazgos sin npm. |
| 6 | `03-viabilidad.md` | Viabilidad de implementar el plan sobre el código actual, bloqueos, riesgos y estado de F0. |
| 7 | `04-plan-de-trabajo.md` | Guía operativa de F1–F9: ramas, tareas, tests, criterios de cierre y pendientes antes de empezar. |

Las decisiones tomadas están en [`docs/adr/`](../adr/README.md).

Los archivos 3 y 4 son los que van en el repo, en `docs/arquitectura-ev/`. Mantén sus nombres: se enlazan entre sí.

`voltia-arquitectura-ev.patch` contiene el mismo commit, para aplicarlo con `git am` si lo prefieres.
