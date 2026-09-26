import { z } from "zod";
import type { NormalizedRecord, StationConnector } from "@/domain/stations/model";
import { standardizeConnector, currentFromStandard } from "@/domain/stations/connectors";
import type { StationSource } from "./types";
import { fetchJson } from "@/infrastructure/providers/http";

const OverpassNodeSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const OverpassResponseSchema = z.object({
  elements: z.array(OverpassNodeSchema).optional(),
});

type OverpassNode = z.infer<typeof OverpassNodeSchema>;

function parseKw(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 1000) return n / 1000;
  return n;
}

function parseSockets(tags: Record<string, string>): StationConnector[] {
  const connectors: StationConnector[] = [];
  
  // Buscar tags que empiecen con "socket:" pero que no sean ":output", ":current", etc.
  const socketKeys = Object.keys(tags).filter(k => k.startsWith("socket:") && !k.includes(":"));
  
  for (const key of socketKeys) {
    const rawConnector = key.replace("socket:", "");
    const standard = standardizeConnector(rawConnector);
    const quantityStr = tags[key];
    const quantity = quantityStr ? parseInt(quantityStr, 10) : null;
    
    const powerStr = tags[`${key}:output`] || tags[`${key}:power`];
    const powerKw = parseKw(powerStr);
    
    let currentOrigin: "reported" | "standard" | null = null;
    let current = null;
    const currentStr = tags[`${key}:current`];
    if (currentStr) {
      if (currentStr.toLowerCase().includes("dc")) {
        current = "DC";
        currentOrigin = "reported";
      } else if (currentStr.toLowerCase().includes("ac")) {
        current = "AC";
        currentOrigin = "reported";
      }
    }
    
    if (!current) {
      current = currentFromStandard(standard);
      if (current) currentOrigin = "standard";
    }

    const voltageStr = tags[`${key}:voltage`];
    const voltageV = voltageStr ? parseInt(voltageStr, 10) : null;

    connectors.push({
      standard,
      rawLabel: rawConnector,
      quantity: Number.isNaN(quantity) ? null : quantity,
      powerKw,
      current: current as any,
      currentOrigin: currentOrigin as any,
      voltageV: Number.isNaN(voltageV) ? null : voltageV,
      amperageA: null, // OSM rara vez reporta amperaje directo en el socket
      status: "unknown",
      confirmed: true,
      sources: ["osm"]
    });
  }

  // Si no hay sockets explícitos, al menos devolvemos uno "other" si sabemos que es estación,
  // pero OSM muchas veces no tiene tags `socket:*`. El plan dice "no se inventan datos".
  // Así que si no hay `socket:*`, devolvemos lista vacía.
  return connectors;
}

function nodeToRecord(n: OverpassNode): NormalizedRecord | null {
  const lat = n.lat ?? n.center?.lat;
  const lon = n.lon ?? n.center?.lon;
  if (lat == null || lon == null) return null;
  
  const tags = n.tags ?? {};
  
  const addressParts = [
    tags["addr:street"], 
    tags["addr:housenumber"], 
    tags["addr:city"]
  ].filter(Boolean).join(" ");
  
  return {
    source: "osm",
    externalId: `${n.type}/${n.id}`,
    name: tags.name || tags["name:es"] || "",
    lat,
    lon,
    address: {
      full: tags["addr:full"] || addressParts || undefined,
      city: tags["addr:city"],
      street: tags["addr:street"]
    },
    operator: tags.operator,
    brand: tags.brand,
    network: tags.network,
    openingHours: tags.opening_hours,
    phone: tags.phone || tags["contact:phone"],
    website: tags.website || tags["contact:website"],
    email: tags.email || tags["contact:email"],
    access: tags.access as any,
    pricing: tags.fee ? { text: tags.fee === "yes" ? "De pago" : tags.fee === "no" ? "Gratis" : tags.fee } : undefined,
    services: [], // En OSM los servicios suelen ser POIs separados (amenity=toilets) cerca, pero a veces vienen tags
    availability: { value: "unknown" },
    connectors: parseSockets(tags),
    attributes: tags, // Guardamos todos los tags crudos
    url: `https://www.openstreetmap.org/${n.type}/${n.id}`
  };
}

export const osmSource: StationSource = {
  id: "osm",
  label: "OpenStreetMap",
  enabled: () => true,
  timeoutMs: 60_000,
  ttlMs: 6 * 60 * 60 * 1000, // 6 horas
  
  async fetchAll(signal: AbortSignal): Promise<NormalizedRecord[]> {
    const query = `
      [out:json][timeout:50];
      area["ISO3166-1"="CO"][admin_level=2]->.co;
      nwr["amenity"="charging_station"](area.co);
      out center tags;
    `;
    
    // Usamos el endpoint principal y un fallback si falla a nivel de HTTP
    const endpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter"
    ];
    
    let lastError: Error | null = null;
    let data: any = null;
    
    for (const endpoint of endpoints) {
      try {
        data = await fetchJson(endpoint, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          signal
        });
        break; // Éxito
      } catch (err: any) {
        lastError = err;
      }
    }
    
    if (!data) {
      throw new Error(`OSM falló en todos los endpoints: ${lastError?.message}`);
    }
    
    const parsed = OverpassResponseSchema.parse(data);
    const elements = parsed.elements || [];
    
    return elements.map(nodeToRecord).filter((r): r is NormalizedRecord => r !== null);
  }
};
