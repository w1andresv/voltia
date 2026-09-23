import type { Charger, ChargerSocket } from "@/domain/types";

/**
 * Verified operator catalog — fallback when OSM/PlugShare are unavailable.
 *
 * Every row is a published charging site:
 * - Terpel Voltex mapped as amenity=charging_station in OSM, or
 * - an official Voltex EDS (BluRadio list, ago 2026) whose Terpel node exists in OSM, or
 * - IONITY sites mapped in OSM.
 *
 * Never add corridor placeholders, town centroids, hotels or guessed mid-route pins.
 */
const TERPEL_UPDATED = "2026-08-18";
const IONITY_UPDATED = "2026-09-22";
const TERPEL_NOTE =
  "Listado Terpel Carga Eléctrica (ago 2026) y nodo OpenStreetMap. Confirma conectores en la app Terpel.";
const IONITY_NOTE = "Estación IONITY mapeada en OpenStreetMap. Confirma disponibilidad en ionity.eu.";

const VOLTEX_SOCKETS: ChargerSocket[] = [
  { connector: "ccs2", powerKw: 50, count: 2 },
  { connector: "type2", powerKw: 22, count: 1 },
];

const IONITY_SOCKETS: ChargerSocket[] = [
  { connector: "ccs2", powerKw: 350, count: 4 },
];

function station(
  name: string,
  lat: number,
  lon: number,
  operator: string,
  address: string,
  sockets: ChargerSocket[],
  updatedAt: string,
  notes: string,
): Charger {
  return {
    id: `cat-${lat.toFixed(5)}-${lon.toFixed(5)}`,
    name,
    lat,
    lon,
    operator,
    sockets,
    access: "public",
    openingHours: "24/7",
    source: "catalog",
    verified: true,
    updatedAt,
    address,
    availability: "unknown",
    available: null,
    notes,
  };
}

function voltex(name: string, lat: number, lon: number, address: string): Charger {
  return station(name, lat, lon, "Terpel Voltex", address, VOLTEX_SOCKETS, TERPEL_UPDATED, TERPEL_NOTE);
}

function ionity(name: string, lat: number, lon: number, address: string): Charger {
  return station(name, lat, lon, "IONITY", address, IONITY_SOCKETS, IONITY_UPDATED, IONITY_NOTE);
}

export const CATALOG_CHARGERS: Charger[] = [
  // Bogotá / Sabana — OSM amenity=charging_station Voltex
  voltex("Voltex Avenida Boyacá", 4.69442, -74.09087, "Avenida Carrera 72, Engativá, Bogotá"),
  voltex("Voltex Las Vegas", 4.58064, -74.15481, "Avenida Carrera 51, Ciudad Bolívar, Bogotá"),
  voltex("Voltex Trinidad", 4.62267, -74.12445, "Avenida Carrera 68, Puente Aranda, Bogotá"),
  voltex("Voltex INTEXZONA Cota", 4.7517, -74.16056, "Vía Funza-Siberia, Siberia, Cota, Cundinamarca"),
  voltex("Voltex La Mesa", 4.63447, -74.44987, "Calle 4, Parque comercial Tequendama, La Mesa, Cundinamarca"),

  // Santander / Boyacá — Voltex OSM + EDS oficiales con nodo Terpel OSM
  voltex("Voltex Piedecuesta", 6.99801, -73.05213, "Autopista Piedecuesta, Comuna del Trapiche, Piedecuesta, Santander"),
  voltex("Voltex Santana", 6.05262, -73.48572, "Vía Vado Real–Barbosa, Santana, Boyacá"),
  voltex("Voltex Espinelis", 5.49102, -73.40247, "Vía Bogotá–Tunja, Tunja, Boyacá"),
  voltex("Terpel Voltex Planta Chimitá", 7.10445, -73.16481, "Autopista Chimitá, Girón, Santander"),
  voltex("Terpel Voltex EDS La Paz", 6.64957, -73.94821, "Troncal del Magdalena Medio, El Cruce, Puerto Parra, Santander"),

  // Antioquia / Ruta del Sol
  voltex("Voltex EDS Garota", 6.30241, -75.45712, "Autopista Medellín–Bogotá, Guarne, Antioquia"),
  voltex("Voltex Popalito", 6.47025, -75.28807, "Transversal Tribugá–Arauca, Popalito, Barbosa, Antioquia"),
  voltex("Voltex Autopista Norte Medellín", 6.3012, -75.56433, "Avenida Carrera 64C, Plaza de Ferias, Medellín"),
  voltex("Voltex El Encierro", 6.2246, -75.569, "Calle 25, El Poblado, Medellín"),
  voltex("Voltex Ancón Sur", 6.13915, -75.63243, "Troncal de Occidente, Sabaneta, Antioquia"),
  voltex("Voltex Montecristo", 5.57638, -74.62292, "Ruta del Sol, Puerto Salgar, Cundinamarca"),

  // Centro / Caribe
  voltex("Voltex Melgar", 4.25279, -74.60991, "Autopista Bogotá–Girardot, Melgar, Tolima"),
  voltex("Voltex Diamante Bosconia", 9.89221, -73.83366, "Ruta del Sol III, Loma Colorada, Bosconia, Cesar"),
  voltex("Voltex Pie del Cerro", 10.42155, -75.54143, "Calle 30, Pie del Cerro, Cartagena"),

  // España — IONITY mapeadas en OSM
  ionity("IONITY Ariza Sur", 41.31128, -2.00306, "A-2, pk 197,2, 50220 Ariza, Zaragoza"),
  ionity("IONITY Ariza Norte", 41.3129, -2.00161, "A-2, pk 197,3, 50220 Ariza, Zaragoza"),
  ionity("IONITY Valdepeñas", 38.8244, -3.39699, "Autovía del Sur, Valdepeñas, Ciudad Real"),
];
