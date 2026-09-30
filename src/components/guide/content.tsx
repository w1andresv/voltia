import type { ReactNode } from "react";
import type { GuideEngine } from "@/lib/guide-sim";
import type { FlowStep } from "./flow-steps";
import { Code } from "./primitives";
import type { Participant, SequenceItem } from "./sequence-diagram";

export type GuideContent = {
  engine: GuideEngine;
  eyebrow: string;
  title: string;
  lead: ReactNode;
  pills: ReactNode[];
  simulatorIntro: string;
  participants: Participant[];
  sequence: SequenceItem[];
  providerLegend: string;
  steps: FlowStep[];
  endpoints: [provider: string, endpoint: ReactNode, when: ReactNode, cache: string][];
  comparison?: [topic: string, v1: string, v2: string][];
  sources: ReactNode;
};

const PHOTON_STEP: FlowStep = {
  actor: "browser",
  who: "Navegador → Servidor → Photon",
  title: "Elegir origen y destino",
  blocks: [
    {
      kind: "columns",
      columns: [
        {
          title: "Entrada",
          items: [
            'Texto que escribe el usuario ("Piedecuesta") o un toque en el mapa.',
            "Centro del mapa para ordenar resultados cercanos.",
          ],
        },
        {
          title: "Algoritmo",
          items: [
            <>
              <Code>searchPlacesFn</Code> y <Code>reversePlaceFn</Code> (server actions) con límite
              de consultas por IP.
            </>,
            <>
              El resultado es un <Code>Place</Code>: <Code>{"{ label, lat, lon, context }"}</Code>.
            </>,
          ],
        },
      ],
    },
    {
      kind: "endpoints",
      lines: [
        {
          method: "GET",
          url: "https://photon.komoot.io/api/?q=Piedecuesta&lat=…&lon=…&lang=es",
          note: "búsqueda, caché 2 min",
        },
        {
          method: "GET",
          url: "https://photon.komoot.io/reverse?lat=6.99&lon=-73.05&lang=es",
          note: "toque en el mapa, caché 5 min",
        },
      ],
    },
    {
      kind: "list",
      list: {
        title: "Salida",
        items: [
          <>
            <Code>origin</Code> y <Code>destination</Code> en el estado del navegador. Cambiarlos
            borra el plan anterior.
          </>,
        ],
      },
    },
  ],
};

const DIRECTIONS_LINES = [
  {
    method: "GET",
    url: "https://api.mapbox.com/directions/v5/mapbox/driving/{lon,lat;lon,lat}\n      ?alternatives=true&geometries=geojson&overview=full&steps=true\n      &annotations=distance,duration,maxspeed[&exclude=toll|point(lon lat)]",
    note: "caché 90 s",
  },
];

const WEATHER_LINE = {
  method: "GET",
  url: "https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…\n      &current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh",
  note: "caché 20 min",
};

const COMMON_START: SequenceItem[] = [
  { from: "U", to: "B", text: "Escribe o toca origen y destino" },
  { from: "B", to: "S", text: "searchPlacesFn / reversePlaceFn" },
  { from: "S", to: "P", text: "/api?q= … /reverse?lat=&lon=" },
];

export const GUIDE_V2: GuideContent = {
  engine: "v2",
  eyebrow: "Motor v2 · programación dinámica",
  title: "Planificador v2: de elegir origen y destino al plan de paradas",
  lead: (
    <>
      Cómo calcula EV-on-way un viaje en <Code>/v2</Code>: qué pide el navegador, qué endpoints
      consulta el servidor, qué entra a cada algoritmo y qué sale. El ejemplo es Piedecuesta → Vélez
      con un MG S5 EV.
    </>
  ),
  pills: [
    <>
      <b>v2</b> programación dinámica
    </>,
    "Energía física por tramo de 100 m",
    <>
      Electrolineras de <b>Blaze</b>
    </>,
    "+10 % en carga rápida antes de otra parada",
    "Pasada 2 con la ruta real",
  ],
  simulatorIntro:
    "Simulación simplificada que sigue las reglas de v2 (piso de batería, reserva al llegar, tope de carga, +10 % en carga rápida cuando hay otra parada después, carga antes de salir). El consumo es un modelo de juguete sobre el perfil de altura aproximado; los números reales salen del terreno de Mapbox y de la física completa. Las estaciones son de ejemplo.",
  participants: [
    { id: "U", label: "Usuario", actor: "user" },
    { id: "B", label: "Navegador", actor: "browser" },
    { id: "S", label: "Servidor EV-on-way", actor: "server" },
    { id: "P", label: "Photon", actor: "provider" },
    { id: "BZ", label: "Blaze API", actor: "provider" },
    { id: "MB", label: "Mapbox", actor: "provider" },
    { id: "OM", label: "Open-Meteo", actor: "provider" },
  ],
  sequence: [
    ...COMMON_START,
    { from: "B", to: "S", text: "GET /api/stations?engine=v2" },
    { from: "S", to: "BZ", text: "GET /stations (X-API-Key, caché 15 min)" },
    { from: "U", to: "B", text: "Planificar viaje" },
    { from: "B", to: "S", text: 'planTripFn({ data, engine: "v2" })' },
    { from: "S", to: "MB", text: "Directions v5 driving (alternativas, sin peajes, correcciones)" },
    { from: "S", to: "MB", text: "Raster Tiles v4 terrain-rgb z11 @2x (elevación)" },
    { from: "S", to: "OM", text: "forecast current (temperatura y viento)" },
    { from: "S", to: "BZ", text: "GET /stations (listado, desde caché)" },
    { note: "Corredor 12 km, filtros, energía v2, programación dinámica", over: ["S"] },
    { from: "S", to: "BZ", text: "GET /stations/{id} solo de las paradas" },
    { from: "S", to: "MB", text: "Directions con las paradas como waypoints (pasada 2)" },
    { from: "S", to: "B", text: "PlanningSnapshot + planes ordenados", reply: true },
    { from: "B", to: "B", text: "Dibuja mapa, paradas y curva de batería" },
  ],
  providerLegend: "Proveedor externo",
  steps: [
    PHOTON_STEP,
    {
      actor: "browser",
      who: "Navegador → Servidor → Blaze",
      title: "Cargar las electrolineras del mapa",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Entrada",
              items: [
                <>
                  La ruta <Code>/v2</Code> fija el motor (<Code>engineChoice = &quot;v2&quot;</Code>
                  ).
                </>,
              ],
            },
            {
              title: "Algoritmo",
              items: [
                <>
                  <Code>BlazeStationCatalog</Code> traduce cada estación: conectores &quot;CCS2,
                  Tipo 2&quot; a estándares, <Code>maxKw</Code> a los conectores DC, estado{" "}
                  <Code>en_servicio</Code> a disponible, <Code>mantenimiento</Code>/
                  <Code>fuera_servicio</Code> a fuera de servicio.
                </>,
                "Evalúa si sirve para planificar (coordenadas en Colombia, conector conocido con potencia, no fuera de servicio).",
                "Con v2 el listado no se guarda en cookies: se refresca cada 15 min.",
              ],
            },
          ],
        },
        {
          kind: "endpoints",
          lines: [
            {
              method: "GET",
              url: "/api/stations?engine=v2",
              note: "interno, ETag = versión del listado",
            },
            {
              method: "GET",
              url: "https://blaze.muvatec.com/electrolineras-api/public/v1/stations\n      X-API-Key: blz_… (solo en el servidor)",
              note: "caché 15 min, sin paginación",
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: [
              <>
                <Code>StationDataset</Code> con versión <Code>blaze-&lt;hash&gt;</Code>; el mapa las
                dibuja y la ficha dice por qué una no sirve para tu vehículo.
              </>,
            ],
          },
        },
      ],
    },
    {
      actor: "browser",
      who: "Navegador → Servidor",
      title: 'Pulsar "Planificar viaje"',
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: (
                <>
                  Entrada: <Code>PlanRequest</Code>
                </>
              ),
              items: [
                <>
                  <Code>origin</Code>, <Code>destination</Code>, <Code>waypoints</Code>
                </>,
                <>
                  <Code>vehicle</Code>: batería 47,1 kWh, DC 120 kW, AC 7 kW, curva de carga,
                  conectores CCS2 y Tipo 2, Cd·A 0,70
                </>,
                <>
                  <Code>conditions</Code>: batería al salir, llegada, margen, estrategia, pasajeros,
                  equipaje, A/C, temperatura, estilo, regeneración
                </>,
                <>
                  <Code>engine: &quot;v2&quot;</Code>, el de la ruta
                </>,
              ],
            },
            {
              title: "Algoritmo",
              items: [
                <>
                  <Code>planTripFn</Code>: valida con zod (<Code>PlanRequestSchema</Code>) y aplica
                  el límite de consultas.
                </>,
                <>
                  Si <Code>ENGINE_PREVIEW_EMAILS</Code> lo permite, v2 = planificador v2 + energía
                  v2 + estaciones de Blaze.
                </>,
                <>
                  Arma el servicio con <Code>createPlanningService</Code> (contenedor de
                  dependencias).
                </>,
              ],
            },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Mapbox",
      title: "Pedir las rutas candidatas",
      blocks: [
        {
          kind: "columns",
          columns: [
            { title: "Entrada", items: ["Origen, puntos intermedios y destino."] },
            {
              title: (
                <>
                  Algoritmo: <Code>selectRoutes</Code>
                </>
              ),
              items: [
                "Pide la ruta con alternativas, otra sin peajes y, si una alternativa usa vías menores para atajar, la vuelve a pedir excluyendo esos puntos.",
                <>
                  Normaliza cada ruta a muestras por distancia con velocidad, límite legal (
                  <Code>maxspeed</Code>), clase de vía y túneles.
                </>,
              ],
            },
          ],
        },
        { kind: "endpoints", lines: DIRECTIONS_LINES },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: [
              <>
                <Code>RawRoute[]</Code>: geometría, muestras, distancia (Piedecuesta → Vélez ≈ 213
                km), tiempo, tramos, túneles.
              </>,
            ],
          },
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Mapbox",
      title: "Perfil de elevación cada 100 m",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Entrada",
              items: ["Cada ruta; un punto cada 100 m (≈ 2 100 puntos en 213 km)."],
            },
            {
              title: "Algoritmo",
              items: [
                "Teselas Terrain-RGB a zoom 11 en 512 px (≈ 38 m por píxel): altura = −10000 + (R·65536 + G·256 + B) × 0,1 m.",
                "Suavizado de 300 m, histéresis de 5 m para subida y bajada, túneles como recta y pendiente máxima 15 %.",
              ],
            },
          ],
        },
        {
          kind: "endpoints",
          lines: [
            {
              method: "GET",
              url: "https://api.mapbox.com/v4/mapbox.terrain-rgb/11/{x}/{y}@2x.pngraw",
              note: "caché sin vencimiento, ~5–6 teselas/100 km nuevos",
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: ["Altura de cada muestra, subida y bajada total, mínimo y máximo."],
          },
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Open-Meteo",
      title: "Clima en el punto medio",
      blocks: [
        { kind: "endpoints", lines: [WEATHER_LINE] },
        {
          kind: "text",
          text: "Temperatura (densidad del aire, A/C, eficiencia en frío) y viento (aerodinámica según el rumbo de cada tramo).",
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor",
      title: "Estaciones del corredor y filtros",
      blocks: [
        {
          kind: "columns",
          columns: [
            { title: "Entrada", items: ["Listado de Blaze, rutas, vehículo."] },
            {
              title: "Algoritmo (en orden)",
              items: [
                "A ≤ 12 km de alguna ruta.",
                "Elegible (listado de Blaze).",
                "Aceptada para planificar (fuente conocida).",
                "Compatible: tiene un conector del vehículo o un adaptador verificado.",
                "En servicio.",
              ],
            },
          ],
        },
        {
          kind: "endpoints",
          lines: [
            { url: "# log del servidor" },
            {
              url: "[plan-trip:stations] blaze: 143 en el listado → 9 a ≤ 12 km de la ruta → 9 elegibles → 9 aceptadas → 8 compatibles con MG S5 EV → 8 en servicio",
            },
            { url: "  descartadas: blz_40 EDS … (sin conector compatible (tiene CCS→other))" },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor (dominio, sin red)",
      title: "Energía v2: física por tramo con perfil de velocidad",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Entrada",
              items: [
                "Muestras con altura, límite legal y clase de vía; clima; vehículo; condiciones.",
              ],
            },
            {
              title: "Algoritmo",
              items: [
                "Velocidad por tramo: la típica de la vía, limitada por curvas (√(a_lat·R)), límite legal o tope por clase (90/80/60/50/40 km/h), aceleraciones y 0 km/h en origen, destino y paradas.",
                "Energía = aire (½ρ·Cd·A·v², con viento) + rodadura (Crr·m·g) + pendiente (m·g·Δh) + aceleración (m_eff), dividida por la eficiencia y el factor de frío.",
                "Regeneración en bajada según el nivel, con tope de potencia; auxiliares 0,45 kW + A/C.",
              ],
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: ["kWh por muestra y tiempo de manejo del perfil de velocidad."],
          },
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor (dominio, sin red)",
      title: "Dónde parar: programación dinámica",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: (
                <>
                  Entrada: <Code>PlannerInput</Code>
                </>
              ),
              items: [
                "Estaciones utilizables en orden de km, con desvío y tabla de minutos de carga (curva del vehículo, +5 min por parada).",
                "Piso = margen de seguridad del viaje; reserva al llegar; tope de carga en ruta (80 %, igual para todos los vehículos).",
                "Estrategia; malla de SOC de 1 punto; regla de carga rápida (+10 hacia otra parada, hasta 90 %).",
              ],
            },
            {
              title: (
                <>
                  Algoritmo: <Code>planCharging</Code>
                </>
              ),
              items: [
                "Estado = (estación, SOC con que sales). Desde cada estado recorre la batería por la ruta; no acepta ningún punto bajo el piso.",
                "Al salir de una estación rápida hacia otra parada, se llega a ella 10 puntos sobre el piso, salvo que salgas con el tope. Hacia el destino solo se pide la reserva.",
                "Compara con criterio por estrategia: más rápida = minutos; menos paradas = paradas; más segura = SOC mínimo.",
                "Si no hay plan, busca (binaria) cuánto cargar antes de salir; si ni al 100 % alcanza, informa el motivo y el km donde se agota la batería.",
              ],
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: [
              <>
                <Code>RoutePlan</Code>: paradas con llegada, mínimo y salida, minutos, extra de
                carga rápida, curva de batería, viabilidad.
              </>,
            ],
          },
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Blaze",
      title: "Detalle de las paradas elegidas",
      blocks: [
        {
          kind: "endpoints",
          lines: [
            {
              method: "GET",
              url: "https://blaze.muvatec.com/electrolineras-api/public/v1/stations/{id}",
              note: "solo paradas, 5 s máx., caché 2 min",
            },
          ],
        },
        {
          kind: "text",
          text: "Si ningún cargador de una parada está en servicio, se marca fuera de servicio y se replanifica una vez (con aviso). Si el detalle trae potencias distintas, también se replanifica.",
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Mapbox",
      title: "Pasada 2: la ruta real pasando por las paradas",
      blocks: [
        {
          kind: "endpoints",
          lines: [
            {
              method: "GET",
              url: "https://api.mapbox.com/directions/v5/mapbox/driving/{origen;parada 1;…;destino}?alternatives=false…",
            },
          ],
        },
        {
          kind: "text",
          text: "Se vuelve a perfilar la elevación y se replanifica solo con las paradas elegidas; si ya no alcanza, con todas las del corredor. Hasta 3 rutas. Resultado: verificado, cambiado o fallido.",
        },
      ],
    },
    {
      actor: "browser",
      who: "Servidor → Navegador",
      title: "Respuesta y lo que hace el navegador",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Salida del servidor",
              items: [
                <>
                  <Code>PlanningSnapshot</Code>: rutas muestreadas, estaciones, clima, avisos,
                  proveedores usados, versión del listado.
                </>,
                "Planes ordenados según la estrategia y el recomendado.",
              ],
            },
            {
              title: "En el navegador",
              items: [
                "Dibuja mapa, paradas, gráficas y aviso de dónde se agota la batería si no alcanza.",
                "Si cambias condiciones (SOC, margen…), recalcula en el navegador con el mismo motor, sin pedir rutas.",
                "Al abrir una estación de Blaze pide su detalle (máx. 30 por minuto por IP).",
              ],
            },
          ],
        },
      ],
    },
  ],
  endpoints: [
    [
      "Photon",
      <>
        <Code>/api</Code>, <Code>/reverse</Code>
      </>,
      "Buscar o tocar un lugar",
      "2–5 min",
    ],
    ["Blaze", <Code key="l">GET /stations</Code>, "Mapa y planificación", "15 min"],
    [
      "Blaze",
      <Code key="d">GET /stations/{"{id}"}</Code>,
      "Paradas del plan; ficha de estación",
      "2 min",
    ],
    [
      "Mapbox",
      <>
        Directions v5 <Code>driving</Code>
      </>,
      "Rutas y pasada 2",
      "90 s",
    ],
    [
      "Mapbox",
      <>
        Raster Tiles v4 <Code>terrain-rgb</Code> z11 @2x
      </>,
      "Elevación",
      "sin vencimiento",
    ],
    ["Open-Meteo", <Code key="f">/v1/forecast</Code>, "Clima", "20 min"],
  ],
  sources: (
    <>
      Parámetros en <Code>src/domain/ev/core/params.ts</Code>; programación dinámica en{" "}
      <Code>src/domain/ev/engines/charging/planner.ts</Code>, que arma{" "}
      <Code>src/domain/plan/stops-v2.ts</Code>; decisiones en los ADR 0007–0014.
    </>
  ),
};

export const GUIDE_V1: GuideContent = {
  engine: "v1",
  eyebrow: "Motor v1 · el actual",
  title: "Planificador v1: de elegir origen y destino al plan de paradas",
  lead: (
    <>
      Cómo calcula EV-on-way un viaje en <Code>/v1</Code>, el motor que responde por defecto (
      <Code>PLANNER_ENGINE=legacy</Code>): qué pide el navegador, qué endpoints consulta el
      servidor, qué entra a cada algoritmo y qué sale. El ejemplo es Piedecuesta → Vélez con un MG
      S5 EV.
    </>
  ),
  pills: [
    <>
      <b>v1</b> paradas por puntaje
    </>,
    "Energía con multiplicadores",
    "Dataset consolidado: OSM, SIVEEIC, comunidad, catálogo",
    "Sin pasada 2",
  ],
  simulatorIntro:
    "Simulación simplificada que sigue las reglas de v1: avanza estación por estación, elige la de mejor puntaje entre las alcanzables y decide cuánto cargar con reglas fijas. El consumo es un modelo de juguete sobre el perfil de altura aproximado; los números reales salen del terreno de Mapbox y del modelo de energía completo. Las estaciones son de ejemplo.",
  participants: [
    { id: "U", label: "Usuario", actor: "user" },
    { id: "B", label: "Navegador", actor: "browser" },
    { id: "S", label: "Servidor EV-on-way", actor: "server" },
    { id: "DB", label: "Postgres", actor: "provider" },
    { id: "SRC", label: "OSM / SIVEEIC", actor: "provider" },
    { id: "P", label: "Photon", actor: "provider" },
    { id: "MB", label: "Mapbox", actor: "provider" },
    { id: "OM", label: "Open-Meteo", actor: "provider" },
  ],
  sequence: [
    ...COMMON_START,
    { from: "B", to: "S", text: "GET /api/stations (cookie 6 h)" },
    { from: "S", to: "DB", text: "dataset consolidado guardado" },
    {
      note: "Cada 6 h o por cron: Overpass + SIVEEIC + comunidad + catálogo → consolidar → guardar",
      over: ["S", "SRC"],
    },
    { from: "U", to: "B", text: "Planificar viaje" },
    { from: "B", to: "S", text: 'planTripFn({ data, engine: "v1" })' },
    { from: "S", to: "MB", text: "Directions v5 driving (alternativas, sin peajes, correcciones)" },
    { from: "S", to: "MB", text: "Raster Tiles v4 terrain-rgb z11 @2x (elevación)" },
    { from: "S", to: "OM", text: "forecast current (temperatura y viento)" },
    { from: "S", to: "DB", text: "dataset consolidado (memoria del proceso)" },
    { note: "Corredor 12 km, filtros, energía v1, paradas por puntaje", over: ["S"] },
    { from: "S", to: "B", text: "PlanningSnapshot + planes ordenados", reply: true },
    { from: "B", to: "B", text: "Dibuja mapa, paradas y curva de batería" },
  ],
  providerLegend: "Proveedor externo o base de datos",
  steps: [
    PHOTON_STEP,
    {
      actor: "browser",
      who: "Navegador → Servidor → Postgres (y fuentes cada 6 h)",
      title: "Cargar las electrolineras del mapa: el dataset consolidado",
      blocks: [
        {
          kind: "columns",
          columns: [
            { title: "Entrada", items: ["Nada del usuario: es el mismo listado para todos."] },
            {
              title: "Algoritmo",
              items: [
                <>
                  <Code>getStationDataset</Code>: memoria del proceso → tabla en Postgres → refresco
                  si tiene más de 6 h (en segundo plano).
                </>,
                <>
                  Refresco (<Code>refreshStationDataset</Code>, con candado para una sola
                  instancia): extrae cuatro fuentes, normaliza conectores y potencias, agrupa
                  duplicados cercanos, fusiona por prioridad de fuente y evalúa si cada estación
                  sirve para planificar.
                </>,
                "El navegador guarda el listado 6 h en una cookie y usa ETag.",
              ],
            },
          ],
        },
        {
          kind: "endpoints",
          lines: [
            { method: "GET", url: "/api/stations", note: "interno, ETag = versión del dataset" },
            {
              method: "POST",
              url: "https://overpass-api.de/api/interpreter",
              note: "OSM",
            },
            {
              method: "GET",
              url: "https://siveeic.minenergia.gov.co:3011/crg/resumenestacionescarga/0/0",
              note: "MinEnergía",
            },
            {
              method: "SQL",
              url: "voltia_stations (aportes aprobados de la comunidad) + catálogo de operadores",
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: [
              <>
                <Code>StationDataset</Code> con versión (hash), estado de cada fuente y
                estadísticas.
              </>,
            ],
          },
        },
      ],
    },
    {
      actor: "browser",
      who: "Navegador → Servidor",
      title: 'Pulsar "Planificar viaje"',
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: (
                <>
                  Entrada: <Code>PlanRequest</Code>
                </>
              ),
              items: [
                <>
                  <Code>origin</Code>, <Code>destination</Code>, <Code>waypoints</Code>
                </>,
                <>
                  <Code>vehicle</Code>: batería 47,1 kWh, DC 120 kW, AC 7 kW, curva de carga,
                  conectores CCS2 y Tipo 2, consumo manual opcional
                </>,
                <>
                  <Code>conditions</Code>: batería al salir, llegada, margen, estrategia, pasajeros,
                  equipaje, A/C, temperatura, estilo, regeneración
                </>,
                <>
                  <Code>engine: &quot;v1&quot;</Code>, el de la ruta
                </>,
              ],
            },
            {
              title: "Algoritmo",
              items: [
                <>
                  <Code>planTripFn</Code>: valida con zod y aplica el límite de consultas.
                </>,
              ],
            },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Mapbox",
      title: "Pedir las rutas candidatas",
      blocks: [
        {
          kind: "columns",
          columns: [
            { title: "Entrada", items: ["Origen, puntos intermedios y destino."] },
            {
              title: (
                <>
                  Algoritmo: <Code>selectRoutes</Code> (compartido con v2)
                </>
              ),
              items: [
                "Ruta con alternativas, otra sin peajes y correcciones si una alternativa ataja por vías menores.",
                "Muestras por distancia con velocidad, límite legal, clase de vía y túneles.",
              ],
            },
          ],
        },
        { kind: "endpoints", lines: DIRECTIONS_LINES },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Mapbox",
      title: "Perfil de elevación cada 100 m",
      blocks: [
        {
          kind: "text",
          text: "Igual que en v2: la fuente de elevación es del servidor, no del motor. Teselas Terrain-RGB a zoom 11 en 512 px, suavizado de 300 m, histéresis de 5 m, túneles y pendiente máxima 15 %.",
        },
        {
          kind: "endpoints",
          lines: [
            {
              method: "GET",
              url: "https://api.mapbox.com/v4/mapbox.terrain-rgb/11/{x}/{y}@2x.pngraw",
              note: "caché sin vencimiento",
            },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor → Open-Meteo",
      title: "Clima en el punto medio",
      blocks: [{ kind: "endpoints", lines: [WEATHER_LINE] }],
    },
    {
      actor: "server",
      who: "Servidor",
      title: "Estaciones del corredor y filtros",
      blocks: [
        {
          kind: "columns",
          columns: [
            { title: "Entrada", items: ["Dataset consolidado, rutas, vehículo."] },
            {
              title: "Algoritmo",
              items: [
                "A ≤ 12 km de alguna ruta y elegible en el dataset.",
                "Aceptada según la fuente: OSM y SIVEEIC sí; comunidad solo aprobada; catálogo solo verificada.",
                "Compatible con el vehículo (o con un adaptador verificado) y no fuera de servicio.",
              ],
            },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor (dominio, sin red)",
      title: "Energía v1: física con multiplicadores",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Entrada",
              items: [
                "Muestras con altura y velocidad del proveedor; clima; vehículo; condiciones.",
              ],
            },
            {
              title: (
                <>
                  Algoritmo: <Code>annotateEnergy</Code>
                </>
              ),
              items: [
                "Velocidad = la del proveedor × estilo (eficiente 0,93, normal 1, deportivo 1,06).",
                "Rodadura + aire × ciclo 1,14 × multiplicador de estilo; pendiente m·g·Δh; tracción ÷ eficiencia × multiplicador de clima.",
                "A/C según temperatura + auxiliares 0,45 kW.",
                "Regeneración: bajo 0,35 · medio 0,55 · alto 0,70, con tope del 40 % de la potencia del motor.",
                "Si el usuario da su consumo (kWh/100 km), se usa ese y se ajusta por velocidad y pendiente.",
              ],
            },
          ],
        },
      ],
    },
    {
      actor: "server",
      who: "Servidor (dominio, sin red)",
      title: "Dónde parar: puntaje, estación por estación",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Entrada",
              items: [
                "Muestras con energía, estaciones ubicadas sobre la ruta (km, desvío), piso = margen de seguridad del viaje, llegada pedida, tope en ruta (80 %).",
              ],
            },
            {
              title: (
                <>
                  Algoritmo: <Code>assessFirstCharger</Code> + <Code>pickStops</Code>
                </>
              ),
              items: [
                "Primero revisa si llegas a la primera estación; si no, calcula cuánto cargar antes de salir.",
                'Mientras no llegues al destino: toma las estaciones alcanzables sobre el piso y les da puntaje (desvío × 3,2 en "más rápida", potencia baja penaliza, llegar muy lleno penaliza, fuera de servicio +90, disponible −6, precio, fuente). Elige la de menor puntaje ("menos paradas": la más lejana).',
                'Cuánto cargar: lo necesario para la siguiente + 2 puntos (4 en otras estrategias); en "más rápida", al menos llegada + 12; en DC, al menos llegada + 8; hasta el tope en ruta.',
                "Máximo 7 paradas.",
              ],
            },
          ],
        },
        {
          kind: "list",
          list: {
            title: "Salida",
            items: [
              <>
                <Code>RoutePlan</Code> con paradas, opciones de carga (directa, adaptador, lenta),
                curva de batería y viabilidad.
              </>,
            ],
          },
        },
      ],
    },
    {
      actor: "browser",
      who: "Servidor → Navegador",
      title: "Respuesta y lo que hace el navegador",
      blocks: [
        {
          kind: "columns",
          columns: [
            {
              title: "Salida del servidor",
              items: [
                <>
                  <Code>PlanningSnapshot</Code>: rutas muestreadas, estaciones, clima, avisos,
                  proveedores, versión del dataset.
                </>,
                "Sin detalle por estación ni pasada 2: los desvíos quedan estimados en línea recta.",
              ],
            },
            {
              title: "En el navegador",
              items: [
                "Dibuja mapa, paradas y gráficas.",
                "Si cambias condiciones, recalcula en el navegador con v1, sin pedir rutas.",
              ],
            },
          ],
        },
      ],
    },
  ],
  endpoints: [
    [
      "Photon",
      <>
        <Code>/api</Code>, <Code>/reverse</Code>
      </>,
      "Buscar o tocar un lugar",
      "2–5 min",
    ],
    ["EV-on-way", <Code key="s">GET /api/stations</Code>, "Mapa y planificación", "cookie 6 h"],
    ["OSM Overpass", <Code key="o">/api/interpreter</Code>, "Refresco del dataset", "6 h"],
    [
      "SIVEEIC (MinEnergía)",
      <Code key="m">/crg/resumenestacionescarga/0/0</Code>,
      "Refresco del dataset",
      "6 h",
    ],
    ["Postgres", "dataset guardado, comunidad, catálogo", "Arranque y refresco", "—"],
    [
      "Mapbox",
      <>
        Directions v5 <Code>driving</Code>
      </>,
      "Rutas",
      "90 s",
    ],
    [
      "Mapbox",
      <>
        Raster Tiles v4 <Code>terrain-rgb</Code> z11 @2x
      </>,
      "Elevación",
      "sin vencimiento",
    ],
    ["Open-Meteo", <Code key="f">/v1/forecast</Code>, "Clima", "20 min"],
  ],
  comparison: [
    [
      "Electrolineras",
      "Dataset consolidado (OSM, SIVEEIC, comunidad, catálogo)",
      "API de Blaze, con detalle de las paradas",
    ],
    [
      "Energía",
      "Física con multiplicadores (ciclo, estilo, clima)",
      "Física por tramo de 100 m con perfil de velocidad",
    ],
    [
      "Paradas",
      "Puntaje, una estación a la vez",
      "Programación dinámica sobre todas las combinaciones",
    ],
    [
      "Carga rápida",
      'Al menos llegada + 8 (o + 12 en "más rápida")',
      "Lo necesario + 10 puntos si hay otra parada después, hasta 90 %",
    ],
    [
      "Verificación",
      "Desvíos estimados, sin pasada 2",
      "Pasada 2 con la ruta real por las paradas",
    ],
  ],
  sources: (
    <>
      <Code>src/domain/plan/stops-v1.ts</Code> (planStopsLegacy, pickStops) y{" "}
      <Code>src/domain/energy.ts</Code>.
    </>
  ),
};
