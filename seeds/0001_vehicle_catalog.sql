-- Catálogo de vehículos (owner_id null) para public.voltia_vehicles.
-- Rerunnable: `npm run db:seed` puede correrse tantas veces como haga falta; cada fila
-- hace upsert por id y nunca pisa un vehículo de usuario (where owner_id is null).
--
-- Fecha de consulta de las fuentes: 2026-09-23, salvo las filas que indican otra (Changan Nevo Q05: 2026-09-30).
-- Etiqueta de cada fuente:
--   [CO]       página o ficha de un sitio colombiano (fabricante, distribuidor o prensa local).
--   [INT]      dato internacional de la MISMA variante, cuando la fuente colombiana no lo publica.
--   [EE.UU.]   cifra del mercado estadounidense del fabricante.
--   [DERIVADO] calculado a partir de otro dato publicado.
--
-- Convenciones de los campos:
--   rangeKm      autonomía WLTP.
--   batteryKwh   capacidad útil/neta cuando se publica; si no, la cifra citada (ver nota de la fila).
--   motorKw      potencia máxima combinada; weightKg peso en vacío.
--   chargeCurve  curva genérica de la app (los fabricantes no la publican; no es verificable).
--   minSocRecommended / maxSocTravel  valores por defecto de la app (15 y 80), no especificaciones.
--   consumptionKwhPer100km  null: la app lo estima con su modelo de energía.
--   bodyType     carrocería (sedan, suv_compact, suv_large).
--   dragAreaM2   Cd x área frontal (m²), desde 2026-09-27 por vehículo. [DERIVADO] Cd publicado x área
--                frontal estimada (0,85 x ancho x alto, sin espejos): los fabricantes no publican el área.
--   rollingResistance  Crr. [ESTIMADO] valor de la carrocería (0,009): ningún fabricante lo publica.
--   maxRegenPowerKw  potencia máxima de regeneración (kW): Tesla medido por usuarios; el resto [ASUMIDO].
--   Eficiencias (drivetrainEfficiency, regenEfficiency), rotationalInertiaFactor y baseAuxPowerKw NO
--                van en el payload: nadie las publica, y sin ellas la app usa ModelParameters.energy y
--                las muestra como "estimadas". Copiarlas aquí las haría pasar por dato del vehículo.
--   Etiquetas extra de las líneas "física": [ASUMIDO] valor sin fuente, deducido de los demás.
--
-- Solo entran vehículos con todos los campos requeridos respaldados por una fuente.
-- Los modelos que faltan (BYD, Hyundai, Kia, Renault, BMW, VW, Zeekr, MG4, MG ZS, Chevrolet)
-- no tienen aún cifras verificables de la versión colombiana: ver docs/catalogo-pendientes.md.

-- MG S5 EV Comfort (2027) - consultado 2026-09-23
--   fuente [CO] https://mgcolombia.com/modelos/mg-s5-suv-electrico/  -> 49 kWh, WLTP 340 km, 125 kW, modelo 2027
--   fuente [CO] https://mgcolombia.com/wp-content/uploads/2023/09/Ficha-Tecnica-MG-S5-EV-SUV-Electrico-MG-Colombia.pdf  -> 49 kWh bruta, 340 km WLTP, 125 kW, 1.627-1.672 kg, AC Tipo 2, DC CCS2 (el encabezado del PDF dice 'ZS HYBRID+': abrirlo y confirmar que es la ficha del S5)
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/mg-s5-ev-precios-datos-colombia-suv-electrica-reta-byd/  -> 47,1 kWh neta (49 bruta), AC 7 kW, DC hasta 120 kW, Comfort 1.627 kg / Deluxe 1.672 kg
--   nota: batteryKwh = capacidad NETA (47,1); la bruta es 49 kWh.
--   física [INT] https://www.zigwheels.ph/car-news/in-7-pictures-mg-motor-ph-launches-all-new-s5-ev  -> Cd 0,27 (otra ficha dice 0,28: se usa 0,275)
--   física [INT] https://www.carsguide.com.au/mg/mgs5-ev/car-dimensions/2026  -> ancho 1.849 mm, alto 1.621 mm
--   física [DERIVADO] dragAreaM2 = 0,275 x (0,85 x 1,849 x 1,621 = 2,55 m²) = 0,70 (área frontal estimada con el factor 0,85 del rectángulo ancho x alto)
--   física [ASUMIDO] maxRegenPowerKw 60: sin dato publicado; menor que los Tesla (75) por motor y batería más pequeños.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('mg-s5-ev-comfort', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"mg-s5-ev-comfort","brand":"MG","model":"S5 EV","year":2027,"version":"Comfort","batteryKwh":47.1,"rangeKm":340,"weightKg":1627,"motorKw":125,"acMaxKw":7,"dcMaxKw":120,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.7,"rollingResistance":0.009,"maxRegenPowerKw":60}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- MG S5 EV Deluxe (2027) - consultado 2026-09-23
--   fuente [CO] https://mgcolombia.com/modelos/mg-s5-suv-electrico/  -> 49 kWh, WLTP 340 km, 125 kW, modelo 2027
--   fuente [CO] https://mgcolombia.com/wp-content/uploads/2023/09/Ficha-Tecnica-MG-S5-EV-SUV-Electrico-MG-Colombia.pdf  -> 49 kWh bruta, 340 km WLTP, 125 kW, 1.627-1.672 kg, AC Tipo 2, DC CCS2 (el encabezado del PDF dice 'ZS HYBRID+': abrirlo y confirmar que es la ficha del S5)
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/mg-s5-ev-precios-datos-colombia-suv-electrica-reta-byd/  -> 47,1 kWh neta (49 bruta), AC 7 kW, DC hasta 120 kW, Comfort 1.627 kg / Deluxe 1.672 kg
--   nota: batteryKwh = capacidad NETA (47,1); la bruta es 49 kWh.
--   física [INT] https://www.zigwheels.ph/car-news/in-7-pictures-mg-motor-ph-launches-all-new-s5-ev  -> Cd 0,27 (otra ficha dice 0,28: se usa 0,275)
--   física [INT] https://www.carsguide.com.au/mg/mgs5-ev/car-dimensions/2026  -> ancho 1.849 mm, alto 1.621 mm
--   física [DERIVADO] dragAreaM2 = 0,275 x (0,85 x 1,849 x 1,621 = 2,55 m²) = 0,70 (área frontal estimada con el factor 0,85 del rectángulo ancho x alto)
--   física [ASUMIDO] maxRegenPowerKw 60: sin dato publicado; menor que los Tesla (75) por motor y batería más pequeños.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('mg-s5-ev-deluxe', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"mg-s5-ev-deluxe","brand":"MG","model":"S5 EV","year":2027,"version":"Deluxe","batteryKwh":47.1,"rangeKm":340,"weightKg":1672,"motorKw":125,"acMaxKw":7,"dcMaxKw":120,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.7,"rollingResistance":0.009,"maxRegenPowerKw":60}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model 3 Long Range AWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-3-colombia-precios-versiones-ficha-tecnica/  -> LR AWD: 75 kWh NMC, 660 km WLTP, 498 hp, 1.828 kg, DC 250 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [CO] https://www.tesla.com/es_co/model3  -> 'hasta 660 km (WLTP)' (confirma la autonomía)
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 75 según la prensa; Tesla no publica capacidad útil vs. bruta.
--   física [INT] https://insideevs.com/news/684644/new-model-3-is-tesla-most-aerodynamic-car-ever-cd-0-219/  -> Cd 0,219 (Model 3 actualizado)
--   física [INT] ancho 1.849 mm (sin espejos), alto 1.441 mm (ficha del Model 3 actualizado)
--   física [DERIVADO] dragAreaM2 = 0,219 x (0,85 x 1,849 x 1,441 = 2,26 m²) = 0,50
--   física [INT] https://teslamotorsclub.com/tmc/threads/max-regen-kw.205243/  -> regeneración máxima ~75 kW (medida por usuarios, no ficha de Tesla)
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-3-lr-awd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-3-lr-awd","brand":"Tesla","model":"Model 3","year":2026,"version":"Long Range AWD","batteryKwh":75,"rangeKm":660,"weightKg":1828,"motorKw":371,"acMaxKw":11.5,"dcMaxKw":250,"connectors":["ccs2","type2"],"bodyType":"sedan","dragAreaM2":0.5,"rollingResistance":0.009,"maxRegenPowerKw":75}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model Y RWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-y-colombia-precios-versiones-datos/  -> RWD: 60 kWh LFP, 466 km WLTP, 299 hp, 1.928 kg, DC 170 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 60 según la prensa; Tesla no publica capacidad útil vs. bruta.
--   física [INT] https://carnewschina.com/2025/01/10/tesla-model-y-juniper-launched-in-china-ahead-of-the-us-starts-at-35950-usd/  -> Cd 0,22 (Model Y 2025, antes 0,23)
--   física [INT] https://www.carsguide.com.au/tesla/model-y/car-dimensions/2025  -> ancho 1.920 mm sin espejos, alto 1.624 mm
--   física [DERIVADO] dragAreaM2 = 0,22 x (0,85 x 1,920 x 1,624 = 2,65 m²) = 0,58
--   física [ASUMIDO] maxRegenPowerKw 75: el del Model 3 (misma plataforma y motor trasero).
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-y-rwd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-y-rwd","brand":"Tesla","model":"Model Y","year":2026,"version":"RWD","batteryKwh":60,"rangeKm":466,"weightKg":1928,"motorKw":223,"acMaxKw":11.5,"dcMaxKw":170,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.58,"rollingResistance":0.009,"maxRegenPowerKw":75}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model Y Long Range AWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-y-colombia-precios-versiones-datos/  -> LR AWD: 75 kWh NMC, 600 km WLTP, 514 hp, 1.992 kg, DC 250 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 75 según la prensa; Tesla no publica capacidad útil vs. bruta.
--   física [INT] https://carnewschina.com/2025/01/10/tesla-model-y-juniper-launched-in-china-ahead-of-the-us-starts-at-35950-usd/  -> Cd 0,22 (Model Y 2025, antes 0,23)
--   física [INT] https://www.carsguide.com.au/tesla/model-y/car-dimensions/2025  -> ancho 1.920 mm sin espejos, alto 1.624 mm
--   física [DERIVADO] dragAreaM2 = 0,22 x (0,85 x 1,920 x 1,624 = 2,65 m²) = 0,58
--   física [ASUMIDO] maxRegenPowerKw 75: el del Model 3 (misma plataforma y motor trasero).
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-y-lr-awd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-y-lr-awd","brand":"Tesla","model":"Model Y","year":2026,"version":"Long Range AWD","batteryKwh":75,"rangeKm":600,"weightKg":1992,"motorKw":383,"acMaxKw":11.5,"dcMaxKw":250,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.58,"rollingResistance":0.009,"maxRegenPowerKw":75}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Volvo EX30 Single Motor Extended Range (2026) - consultado 2026-09-23
--   fuente [CO] https://www.volvocars.com/co/cars/ex30-electric/  -> Extended Range: hasta 476 km, hasta 200 kW, DC 150 kW, modelo 2026
--   fuente [INT] https://evkx.net/models/volvo/ex30/ex30_single_motor_extended_range/  -> 64 kWh útil / 69 bruta, 1.775 kg, AC 11 kW, CCS2 (misma variante: coinciden 476 km y 200 kW; es un agregador, no la ficha del fabricante)
--   nota: Batería, peso, AC y conector vienen de una fuente internacional, no de una colombiana: confirmar con la ficha de Volvo Colombia.
--   física [INT] https://www.evspecs.org/technical-data/volvo/ex30/drag-coefficient  -> Cd 0,28
--   física [INT] https://www.carsguide.com.au/volvo/ex30/car-dimensions  -> ancho 1.837 mm, alto 1.549 mm
--   física [DERIVADO] dragAreaM2 = 0,28 x (0,85 x 1,837 x 1,549 = 2,42 m²) = 0,68
--   física [ASUMIDO] maxRegenPowerKw 60: sin dato publicado; igual que el MG S5.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('volvo-ex30-sm-er', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"volvo-ex30-sm-er","brand":"Volvo","model":"EX30","year":2026,"version":"Single Motor Extended Range","batteryKwh":64,"rangeKm":476,"weightKg":1775,"motorKw":200,"acMaxKw":11,"dcMaxKw":150,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.68,"rollingResistance":0.009,"maxRegenPowerKw":60}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Changan Nevo Q05 E-MAX (2026) - consultado 2026-09-30
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/changan-nevo-q05-colombia-suv-electrica-asequible-precio-datos/  -> 51,9 kWh LFP (CATL), 455 km NEDC, 160,9 hp, E-MAX 1.510 kg / E-MAX Ultra 1.550 kg, AC 6,6 kW, Tipo 2 / CCS2
--   fuente [CO] https://www.elcarrocolombiano.com/pruebas/changan-nevo-q05-ultra-suv-electrica-primer-contacto/  -> con carga completa el computador del carro estimó 405 km ("proyección del vehículo, no una homologación WLTP")
--   fuente [CO] https://changan.com.co/nevo-q05/  -> versiones E-MAX y E-MAX Ultra, 455 km NEDC, 51,9 kWh, carga rápida 3C (30-80 % en 15 min)
--   fuente [INT] https://data.carnewschina.com/database/changan-nevo/changan-nevo-q05/2026/params  -> DC 162 kW, AC 6,6 kW (misma batería de 51,9 kWh; la prensa colombiana dice que los 162 kW aún no se confirman para Colombia)
--   fuente [DERIVADO] motorKw = 160,9 hp x 0,7457 = 120 kW
--   nota: rangeKm 405 NO es un WLTP homologado: Changan Colombia solo publica 455 km NEDC. Se usa 405 como WLTP por
--         decisión del dueño del producto (2026-09-30): es la estimación del computador tras carga completa y cuadra con
--         455 NEDC x ~0,89. Ojo: en China "405 km" es la cifra CLTC de otra versión (40,3 kWh); la de 51,9 kWh da 506 km CLTC.
--   nota: batteryKwh = 51,9 según la marca; no se publica capacidad útil vs. bruta. year = 2026, año del lanzamiento en
--         Colombia (agosto de 2026): la marca no publica el año modelo.
--   nota: las páginas se consultaron a través de un buscador (el entorno no permitía abrirlas): confirmar con la ficha.
--   física [INT] https://data.carnewschina.com/database/changan-nevo/changan-nevo-q05/2026/params  -> Cd 0,265; 4.435 x 1.855 x 1.600 mm
--   física [DERIVADO] dragAreaM2 = 0,265 x (0,85 x 1,855 x 1,600 = 2,52 m²) = 0,67
--   física [ASUMIDO] maxRegenPowerKw 60: sin dato publicado; igual que el MG S5 (SUV compacto LFP de potencia parecida).
--   nota: los 405 km se midieron en la E-MAX Ultra; la E-MAX (rines más pequeños) no tiene cifra propia y usa la misma.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('changan-nevo-q05-e-max', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"changan-nevo-q05-e-max","brand":"Changan","model":"Nevo Q05","year":2026,"version":"E-MAX","batteryKwh":51.9,"rangeKm":405,"weightKg":1510,"motorKw":120,"acMaxKw":6.6,"dcMaxKw":162,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.67,"rollingResistance":0.009,"maxRegenPowerKw":60}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Changan Nevo Q05 E-MAX Ultra (2026) - consultado 2026-09-30
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/changan-nevo-q05-colombia-suv-electrica-asequible-precio-datos/  -> 51,9 kWh LFP (CATL), 455 km NEDC, 160,9 hp, E-MAX 1.510 kg / E-MAX Ultra 1.550 kg, AC 6,6 kW, Tipo 2 / CCS2
--   fuente [CO] https://www.elcarrocolombiano.com/pruebas/changan-nevo-q05-ultra-suv-electrica-primer-contacto/  -> con carga completa el computador del carro estimó 405 km ("proyección del vehículo, no una homologación WLTP")
--   fuente [CO] https://changan.com.co/nevo-q05/  -> versiones E-MAX y E-MAX Ultra, 455 km NEDC, 51,9 kWh, carga rápida 3C (30-80 % en 15 min)
--   fuente [INT] https://data.carnewschina.com/database/changan-nevo/changan-nevo-q05/2026/params  -> DC 162 kW, AC 6,6 kW (misma batería de 51,9 kWh; la prensa colombiana dice que los 162 kW aún no se confirman para Colombia)
--   fuente [DERIVADO] motorKw = 160,9 hp x 0,7457 = 120 kW
--   nota: rangeKm 405 NO es un WLTP homologado: Changan Colombia solo publica 455 km NEDC. Se usa 405 como WLTP por
--         decisión del dueño del producto (2026-09-30): es la estimación del computador tras carga completa y cuadra con
--         455 NEDC x ~0,89. Ojo: en China "405 km" es la cifra CLTC de otra versión (40,3 kWh); la de 51,9 kWh da 506 km CLTC.
--   nota: batteryKwh = 51,9 según la marca; no se publica capacidad útil vs. bruta. year = 2026, año del lanzamiento en
--         Colombia (agosto de 2026): la marca no publica el año modelo.
--   nota: las páginas se consultaron a través de un buscador (el entorno no permitía abrirlas): confirmar con la ficha.
--   física [INT] https://data.carnewschina.com/database/changan-nevo/changan-nevo-q05/2026/params  -> Cd 0,265; 4.435 x 1.855 x 1.600 mm
--   física [DERIVADO] dragAreaM2 = 0,265 x (0,85 x 1,855 x 1,600 = 2,52 m²) = 0,67
--   física [ASUMIDO] maxRegenPowerKw 60: sin dato publicado; igual que el MG S5 (SUV compacto LFP de potencia parecida).
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('changan-nevo-q05-e-max-ultra', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"changan-nevo-q05-e-max-ultra","brand":"Changan","model":"Nevo Q05","year":2026,"version":"E-MAX Ultra","batteryKwh":51.9,"rangeKm":405,"weightKg":1550,"motorKw":120,"acMaxKw":6.6,"dcMaxKw":162,"connectors":["ccs2","type2"],"bodyType":"suv_compact","dragAreaM2":0.67,"rollingResistance":0.009,"maxRegenPowerKw":60}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;
