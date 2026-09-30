# 0017. Sin "Llegada mínima": el margen de seguridad también es la reserva al destino

- Estado: aceptada
- Fecha: 2026-09-30
- Complementa a: [0016](./0016-margen-solo-en-el-viaje.md)

## Contexto
Además del "Margen de seguridad" del viaje, el panel de batería tenía "Llegada mínima" (`TripConditions.arrivalSoc`, 20 % por defecto). El objetivo al destino era `max(arrivalSoc, margen)`, así que:
- con los valores por defecto el destino exigía 20 % mientras la pantalla decía margen "Normal" (15 %);
- la etiqueta "Reserva" del panel de batería mostraba 20 % aunque la reserva en ruta era 15 %;
- cambiar el margen no cambiaba el destino si la llegada mínima era mayor, y las previsualizaciones del margen no lo reflejaban;
- con "Permitir bajar del margen", v2 pedía al destino `max(arrivalSoc, 2 %)` y v1 `max(arrivalSoc, margen)`.

## Decisión
- Se elimina `arrivalSoc` de `TripConditions`, del panel de batería, del landing, del diagnóstico y del simulador de las guías, en v1 y en v2.
- `reserveSocPct(condiciones)` (antes `socFloors`) es la única fuente: el margen de seguridad es el piso en toda la ruta y la reserva al llegar al destino.
- "Permitir bajar del margen" solo baja el piso en ruta, a `belowSafetyFloorPct` = 5 % (antes 2 %). Al destino se sigue pidiendo el margen, en los dos motores.

## Consecuencias
- Con los valores por defecto el destino pasa de exigir 20 % a exigir 15 %.
- Los viajes guardados, compartidos y el último plan que traen `arrivalSoc` se siguen leyendo (Zod descarta la clave); el store del navegador la quita al restaurar las preferencias. Al recalcularlos, el destino usa el margen.
- `arrivalSoc` sigue existiendo como resultado del plan (con cuánto se llega) y en la calibración ("¿Con cuánto llegaste?"): son otro concepto.
