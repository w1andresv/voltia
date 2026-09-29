# 0014. Calibración con el SOC de llegada ("¿Con cuánto llegaste?")

- Estado: aceptada
- Fecha: 2026-09-26
- Fase: calibración (guía 05, §5.8, D13)

## Contexto
Casi todos los parámetros físicos y de conducción son `estimated`. La especificación (§9) define el contrato `TripObservation`, pero no cómo se consiguen los datos. El dueño del producto eligió (D13) empezar pidiendo al usuario el SOC con que llegó, desde "Mis viajes"; importar datos del vehículo queda para después.

## Decisión
- **Pantalla:** en "Mis viajes", los viajes de la cuenta tienen un botón **"¿Con cuánto llegaste?"**, con el SOC de llegada (obligatorio) y el de salida (opcional; por defecto, el del plan). Después se muestra "Llegaste con X %; el plan dijo Y %: fue optimista/conservador por Z puntos", y se puede corregir. Los viajes del invitado no lo tienen: no hay dónde guardarlo.
- **Tabla** `public.voltia_trip_observations` (migración 0014):
  - una fila por viaje (la última reemplaza), con `payload` (`TripObservation`), `comparison` (`ObservationComparison`) y `model_version`;
  - seguridad por fila: solo el dueño;
  - se borra con el viaje.
- **Caso de uso** `application/calibration/record-arrival.ts`:
  - reconstruye desde el snapshot del viaje el plan que el usuario vio (el de distancia más parecida al resumen) y lo compara con `compareObservation`, descontando las cargas del plan;
  - sin snapshot (viajes viejos) compara solo con el resumen guardado.
- **Acción** `recordArrivalFn` (valida 0–100 %, solo viajes del usuario). `listMyTripsFn` agrega a cada viaje lo registrado; si la tabla aún no existe, el historial carga igual.
- **Lectura agregada:** `npm run calibration:report` (solo lectura) muestra, por versión del modelo y vehículo, la cantidad de viajes, el error medio y el error absoluto medio de SOC al llegar, y la razón de consumo observado/predicho.

## Consecuencias
- Hay que aplicar la migración 0014 (`npm run db:migrate`) antes de que el botón guarde. Sin ella, la app sigue funcionando y el botón muestra el error de guardado.
- El dato es simple y ruidoso: el usuario pudo no seguir el plan (otra velocidad, otras cargas). Sirve para detectar sesgos por modelo y vehículo con varios viajes, no para calibrar con uno solo.
- **Ajuste automático (2026-09-29):** `npm run calibration:fit` propone parámetros ajustados con las observaciones (guía §5.8 paso 3). No los escribe.
- **Pendiente:** correr el ajuste cuando haya suficientes viajes, e importar datos del vehículo (API del fabricante, OBD).
