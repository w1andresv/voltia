-- Catálogo de vehículos (owner_id null) para public.voltia_vehicles.
-- Rerunnable: `npm run db:seed` puede correrse tantas veces como haga falta; cada fila
-- hace upsert por id y nunca pisa un vehículo de usuario (where owner_id is null).
--
-- Fecha de consulta de todas las fuentes: 2026-09-23.
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
--
-- Solo entran vehículos con todos los campos requeridos respaldados por una fuente.
-- Los modelos que faltan (BYD, Hyundai, Kia, Renault, BMW, VW, Zeekr, MG4, MG ZS, Chevrolet)
-- no tienen aún cifras verificables de la versión colombiana: ver docs/catalogo-pendientes.md.

-- MG S5 EV Comfort (2027) - consultado 2026-09-23
--   fuente [CO] https://mgcolombia.com/modelos/mg-s5-suv-electrico/  -> 49 kWh, WLTP 340 km, 125 kW, modelo 2027
--   fuente [CO] https://mgcolombia.com/wp-content/uploads/2023/09/Ficha-Tecnica-MG-S5-EV-SUV-Electrico-MG-Colombia.pdf  -> 49 kWh bruta, 340 km WLTP, 125 kW, 1.627-1.672 kg, AC Tipo 2, DC CCS2 (el encabezado del PDF dice 'ZS HYBRID+': abrirlo y confirmar que es la ficha del S5)
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/mg-s5-ev-precios-datos-colombia-suv-electrica-reta-byd/  -> 47,1 kWh neta (49 bruta), AC 7 kW, DC hasta 120 kW, Comfort 1.627 kg / Deluxe 1.672 kg
--   nota: batteryKwh = capacidad NETA (47,1); la bruta es 49 kWh.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('mg-s5-ev-comfort', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"mg-s5-ev-comfort","brand":"MG","model":"S5 EV","year":2027,"version":"Comfort","batteryKwh":47.1,"rangeKm":340,"weightKg":1627,"motorKw":125,"acMaxKw":7,"dcMaxKw":120,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- MG S5 EV Deluxe (2027) - consultado 2026-09-23
--   fuente [CO] https://mgcolombia.com/modelos/mg-s5-suv-electrico/  -> 49 kWh, WLTP 340 km, 125 kW, modelo 2027
--   fuente [CO] https://mgcolombia.com/wp-content/uploads/2023/09/Ficha-Tecnica-MG-S5-EV-SUV-Electrico-MG-Colombia.pdf  -> 49 kWh bruta, 340 km WLTP, 125 kW, 1.627-1.672 kg, AC Tipo 2, DC CCS2 (el encabezado del PDF dice 'ZS HYBRID+': abrirlo y confirmar que es la ficha del S5)
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/mg-s5-ev-precios-datos-colombia-suv-electrica-reta-byd/  -> 47,1 kWh neta (49 bruta), AC 7 kW, DC hasta 120 kW, Comfort 1.627 kg / Deluxe 1.672 kg
--   nota: batteryKwh = capacidad NETA (47,1); la bruta es 49 kWh.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('mg-s5-ev-deluxe', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"mg-s5-ev-deluxe","brand":"MG","model":"S5 EV","year":2027,"version":"Deluxe","batteryKwh":47.1,"rangeKm":340,"weightKg":1672,"motorKw":125,"acMaxKw":7,"dcMaxKw":120,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model 3 Long Range AWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-3-colombia-precios-versiones-ficha-tecnica/  -> LR AWD: 75 kWh NMC, 660 km WLTP, 498 hp, 1.828 kg, DC 250 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [CO] https://www.tesla.com/es_co/model3  -> 'hasta 660 km (WLTP)' (confirma la autonomía)
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 75 según la prensa; Tesla no publica capacidad útil vs. bruta.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-3-lr-awd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-3-lr-awd","brand":"Tesla","model":"Model 3","year":2026,"version":"Long Range AWD","batteryKwh":75,"rangeKm":660,"weightKg":1828,"motorKw":371,"acMaxKw":11.5,"dcMaxKw":250,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model Y RWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-y-colombia-precios-versiones-datos/  -> RWD: 60 kWh LFP, 466 km WLTP, 299 hp, 1.928 kg, DC 170 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 60 según la prensa; Tesla no publica capacidad útil vs. bruta.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-y-rwd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-y-rwd","brand":"Tesla","model":"Model Y","year":2026,"version":"RWD","batteryKwh":60,"rangeKm":466,"weightKg":1928,"motorKw":223,"acMaxKw":11.5,"dcMaxKw":170,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Tesla Model Y Long Range AWD (2026) - consultado 2026-09-23
--   fuente [CO] https://www.elcarrocolombiano.com/lanzamientos/tesla-model-y-colombia-precios-versiones-datos/  -> LR AWD: 75 kWh NMC, 600 km WLTP, 514 hp, 1.992 kg, DC 250 kW, Tipo 2 / CCS2, modelo 2026
--   fuente [EE.UU.] https://www.tesla.com/support/charging/onboard-charger  -> AC 11,5 kW (cifra del mercado de EE. UU.; Tesla no publica la de Colombia)
--   fuente [DERIVADO] motorKw = hp publicados x 0,7457 (la fuente da caballos, no kW)
--   nota: batteryKwh = 75 según la prensa; Tesla no publica capacidad útil vs. bruta.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('tesla-model-y-lr-awd', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.7},{"soc":10,"powerFactor":1},{"soc":25,"powerFactor":1},{"soc":50,"powerFactor":0.82},{"soc":70,"powerFactor":0.5},{"soc":80,"powerFactor":0.32},{"soc":90,"powerFactor":0.18},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"tesla-model-y-lr-awd","brand":"Tesla","model":"Model Y","year":2026,"version":"Long Range AWD","batteryKwh":75,"rangeKm":600,"weightKg":1992,"motorKw":383,"acMaxKw":11.5,"dcMaxKw":250,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;

-- Volvo EX30 Single Motor Extended Range (2026) - consultado 2026-09-23
--   fuente [CO] https://www.volvocars.com/co/cars/ex30-electric/  -> Extended Range: hasta 476 km, hasta 200 kW, DC 150 kW, modelo 2026
--   fuente [INT] https://evkx.net/models/volvo/ex30/ex30_single_motor_extended_range/  -> 64 kWh útil / 69 bruta, 1.775 kg, AC 11 kW, CCS2 (misma variante: coinciden 476 km y 200 kW; es un agregador, no la ficha del fabricante)
--   nota: Batería, peso, AC y conector vienen de una fuente internacional, no de una colombiana: confirmar con la ficha de Volvo Colombia.
insert into public.voltia_vehicles as v (id, owner_id, payload)
values ('volvo-ex30-sm-er', null, '{"chargeCurve":[{"soc":0,"powerFactor":0.55},{"soc":8,"powerFactor":0.9},{"soc":15,"powerFactor":1},{"soc":40,"powerFactor":1},{"soc":55,"powerFactor":0.86},{"soc":70,"powerFactor":0.64},{"soc":80,"powerFactor":0.42},{"soc":90,"powerFactor":0.22},{"soc":100,"powerFactor":0.08}],"minSocRecommended":15,"maxSocTravel":80,"consumptionKwhPer100km":null,"consumptionManual":false,"id":"volvo-ex30-sm-er","brand":"Volvo","model":"EX30","year":2026,"version":"Single Motor Extended Range","batteryKwh":64,"rangeKm":476,"weightKg":1775,"motorKw":200,"acMaxKw":11,"dcMaxKw":150,"connectors":["ccs2","type2"]}'::jsonb)
on conflict (id) do update
  set payload = excluded.payload, updated_at = now()
  where v.owner_id is null;
