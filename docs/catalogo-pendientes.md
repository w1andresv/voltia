# Catálogo de vehículos: qué entró al seed y qué falta

Consulta hecha el 2026-09-23. `seeds/0001_vehicle_catalog.sql` solo incluye vehículos con **todos** los
campos requeridos (`batteryKwh`, `rangeKm`, `weightKg`, `motorKw`, `acMaxKw`, `dcMaxKw`, `connectors`)
respaldados por una fuente. Lo demás queda aquí, con lo que sí se encontró y lo que falta.

## Entraron (11)

| id | Qué respalda la fila | Confianza |
| --- | --- | --- |
| `mg-s5-ev-comfort`, `mg-s5-ev-deluxe` | Todo de fuentes colombianas (MG Colombia, ficha PDF, prensa) | Alta. Abrir el PDF a mano: su encabezado dice "ZS HYBRID+" aunque las cifras coinciden con el S5 |
| `tesla-model-3-lr-awd`, `tesla-model-y-rwd`, `tesla-model-y-lr-awd` | Batería, autonomía, peso y DC de prensa colombiana; AC de Tesla EE. UU. (11,5 kW); kW derivados de hp | Media. Tesla no publica batería útil ni AC para Colombia |
| `volvo-ex30-sm-er` | Autonomía, potencia y DC de Volvo Colombia; batería, peso, AC y conector de un agregador internacional | Media. Confirmar con la ficha de Volvo Colombia |
| `changan-nevo-q05-e-max`, `changan-nevo-q05-e-max-ultra` (2026-09-30) | Batería, potencia, peso por versión, AC y conector de prensa colombiana y Changan Colombia; DC 162 kW de un agregador internacional | Media-baja. **La autonomía (405 km) no es WLTP homologado**: Changan solo publica 455 km NEDC; 405 es la estimación del computador (prueba de El Carro Colombiano) y se usa como WLTP por decisión del dueño del producto. Confirmar DC en Colombia |
| `geely-ex5-pro`, `geely-ex5-max` (2026-09-30) | Batería (60,22 kWh), WLTP 425 km, potencia, peso por versión (1.730 / 1.770 kg), AC 7 kW, DC 110 kW y conector de prensa colombiana y el concesionario Massy Motors | Media. El concesionario dice "hasta 430 km"; en Europa la Max con rines de 19" homologa 410 km (solo informativo) |
| `geely-ex5-se` (2026-09-30) | Batería (49,52 kWh), WLTP 345 km y potencia de prensa colombiana; DC 100 kW de la misma variante en Uruguay; peso 1.630 kg de la versión china de 49,52 kWh | Media-baja. **Colombia no publica peso ni AC de la SE**: el AC (7 kW) se asume igual a Pro/Max. La prensa colombiana dice DC 110 kW, pero es la cifra de Pro/Max |

## No entraron: qué se encontró y qué falta

| Modelo (versión en Colombia) | Encontrado | Falta o es dudoso |
| --- | --- | --- |
| MG4 Cross Deluxe 64 kWh / Plus 51 kWh | Deluxe: 61,7 kWh neta, 450 km WLTP, 150 kW, AC 11 kW. Plus: 50,8 kWh neta, 350 km, 125 kW, AC 6,6 kW (elcarrocolombiano) | DC máx y peso |
| MG4 EV Urban (2027) | 42,8 kWh, 325 km WLTP | Potencia, peso, AC, DC |
| MG ZS EV Comfort (2024) | 51 kWh, 320 km WLTP, 174 hp (MG Colombia) | Peso, AC, DC. El dato internacional hallado es de una versión anterior (115 kW) |
| Tesla Model 3 RWD | 60 kWh LFP, 520 km WLTP, 283 hp, 1.765 kg | DC (la nota dice 250 kW pero el Model Y RWD dice 170) y AC (7,7 kW en EE. UU.) |
| BYD Atto 3 | Nada de una fuente colombiana | Todo. Solo hay datos internacionales (58 kWh útil, 420 km, 150 kW, 1.750 kg, AC 7, DC 88) sin confirmar que sean los de Colombia |
| BYD Seal AWD (2024) | 82,6 kWh, hasta 520 km (WLTC), 522 hp, DC 150 kW | Peso. El AC "5,6 kW" de la fuente parece un error (el Seal internacional es 11 kW). La página de autocosmos devolvió 429 |
| BYD Dolphin | 2022: 44,9 kWh, 405 km NEDC, 70 kW. 2026: 60,4 kWh, 420 km CLTC, 174 hp, 1.400 kg | AC, DC y una autonomía WLTP. Los ciclos NEDC/CLTC no son comparables con WLTP |
| Hyundai Ioniq 5 EV-Power (2025) | 215 hp, 1.990 kg, tracción trasera (autocosmos) | Batería, autonomía, AC, DC. La página oficial de Hyundai Colombia dio 404 |
| Kia EV6 GT Line (2025) | 77,4 kWh, 528 km (ciclo sin indicar), 225-228 hp, 1.910 kg, tracción trasera | AC y DC. El 11 kW / 350 kW hallado es de otra versión (AWD de 2022). Autocosmos indica conector CCS1 |
| Volkswagen ID.4 | Solo notas previas al lanzamiento de 2023 | No confirmé que siga a la venta en Colombia |
| Renault Megane E-Tech Techno (2025) | Solo el nombre de la versión | Todo. La ficha oficial de Renault Colombia devolvió 410 |
| BMW iX1 (xDrive30 y eDrive20, 2026) | xDrive30 xLine 2023: 64,7 kWh neta, 440 km WLTP, 230 kW, DC 130 kW | Peso, AC, y cifras de las versiones 2026 |
| Chevrolet Bolt EUV LT (2022) | 65 kWh, 456 km WLTP según prensa (397 km EPA), 150 kW, DC 55 kW | Conector en Colombia (EE. UU. es CCS1), y que siga a la venta. Peso 1.680 kg y AC 11 kW solo de fuente internacional |
| Zeekr X Premium RWD / Flagship AWD (2024) | 66 kWh, 440 / 400 km (ciclo sin indicar), 272 / 428 hp, AC 22 kW, DC 150 kW | Peso. El agregador internacional da 365 kW para el AWD, que no cuadra con 428 hp |

Cuando consigas la ficha de una de estas versiones, agrega la fila al seed con sus fuentes y vuelve a
correr `npm run db:seed`.

## Parámetros físicos por vehículo (2026-09-27)

Cada cifra tiene su fuente en `seeds/0001_vehicle_catalog.sql`, en las líneas que empiezan con `física`. El área frontal se estima como 0,85 × ancho × alto sin espejos, porque ningún fabricante la publica.

| Vehículo | Cd | Ancho × alto (mm) | Área (m²) | Cd·A (antes) | Regeneración máx. |
|---|---|---|---|---|---|
| MG S5 EV (Comfort y Deluxe) | 0,27–0,28 → 0,275 | 1.849 × 1.621 | 2,55 | **0,70** (0,75) | 60 kW, asumido |
| Tesla Model 3 LR AWD | 0,219 | 1.849 × 1.441 | 2,26 | **0,50** (0,55) | 75 kW, medido por usuarios |
| Tesla Model Y RWD y LR AWD | 0,22 | 1.920 × 1.624 | 2,65 | **0,58** (0,75) | 75 kW, asumido del Model 3 |
| Volvo EX30 SM ER | 0,28 | 1.837 × 1.549 | 2,42 | **0,68** (0,75) | 60 kW, asumido |
| Changan Nevo Q05 (E-MAX y E-MAX Ultra) | 0,265 | 1.855 × 1.600 | 2,52 | **0,67** (—) | 60 kW, asumido |
| Geely EX5 (SE, Pro y Max) | 0,269 | 1.901 × 1.670 | 2,70 | **0,73** (—) | 60 kW, asumido |

**Sin fuente para ningún vehículo** (quedan con los valores por defecto marcados "estimado"):
- rodadura (Crr 0,009);
- eficiencia de tracción (0,90) y de regeneración (0,80);
- factor de inercia (1,05);
- auxiliares (0,45 kW).

Se ajustarán con la calibración de "¿Con cuánto llegaste?".
