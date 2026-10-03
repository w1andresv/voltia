# 0024. Clima por tramo y por hora de paso

- Estado: aceptada
- Fecha: 2026-10-03
- Fase: M3

## Contexto
La energía v2 usaba un solo punto de clima (el de ahora, en la mitad de la ruta) para todo el viaje. Una ruta como Bucaramanga → Bogotá pasa de 25 °C a 12 °C, el viento cambia de un valle a otro y la lluvia es local y pasajera.

## Decisión
- **Datos.** `WeatherProvider.along(points, hours)` (opcional, el puerto conserva `current`) devuelve una serie por hora en cada punto: temperatura, viento, dirección y lluvia. El adaptador de Open-Meteo hace **una sola consulta** por ruta con todos los puntos, a partir de la hora actual (horas en GMT; coordenadas redondeadas a 0,05° para compartir caché). Si la respuesta no cuadra, devuelve `null` y el plan sigue con el clima de un punto.
- **Puntos.** `weatherPointsAlong`: origen, uno cada ~50 km y destino, como mucho 10 (`ModelParameters.weather.alongRoute`).
- **Snapshot.** `GeoBundle.weatherAlong` (por id de ruta, opcional, solo con la energía v2): `departIso` (la hora de la consulta, con el reloj inyectado) y las series con su km. El navegador recalcula con él lo mismo que el servidor; la huella solo cuenta el campo cuando existe, así el hash de los snapshots anteriores no cambia. Pesa unos pocos KB por ruta.
- **Cálculo.** `weatherAtKm(campo, km, segundos)` (función pura): interpola entre las horas de cada serie y, entre los dos puntos que rodean al km, por distancia; la dirección del viento por el arco corto. El tiempo hasta cada km sale del perfil de velocidad (que no depende del clima). `energyProfileV2` arma el contexto de cada tramo con ese clima y decide la vía mojada tramo a tramo. La temperatura que escribió el usuario sigue mandando sobre la del clima.
- **Supuestos.** El plan dice `energy.weatherAlongRoute` (puntos y horas).

## Consecuencias
- Solo con `ENERGY_ENGINE=v2`; sin el campo, la energía es exactamente la de antes.
- **El tiempo no cuenta las paradas a cargar:** el perfil de energía es independiente del SOC y de las paradas (F3), así que la hora de un km no suma lo que se tarda cargando antes. Con paradas largas, el clima de los tramos finales es el de una hora antes. Es una aproximación a favor de la simplicidad.
- La hora de salida es la de la consulta. La funcionalidad "Hora de salida" (elegirla) se monta encima: basta cambiar `departIso`.
- **Sin verificar con la API real:** los nombres de los parámetros (`hourly`, `forecast_hours`, varias coordenadas, `timezone=GMT`) y la forma de la respuesta son los que documenta Open-Meteo; las pruebas usan respuestas sintéticas con esa forma. Hay que contrastar con una consulta real antes de confiar.
- Una consulta más por ruta (hasta 4 por planificación, en paralelo con la elevación). El uso gratuito de Open-Meteo es no comercial (ya anotado en la guía 05).
