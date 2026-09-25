import { describe, expect, it } from "vitest";
import type { ChargeStop } from "@/domain/types";
import { getAppleMapsUrl, getGoogleMapsUrl, getWazeUrl, singleDestinationFor } from "./navigators";

const ORIGIN = { lat: 4.65, lon: -74.1 };
const DESTINATION = { lat: 6.25, lon: -75.56 };
const STOP_POINT = { lat: 5.07, lon: -75.52 };

function stop(): ChargeStop {
  return {
    charger: { id: "s1", name: "Estación", lat: STOP_POINT.lat, lon: STOP_POINT.lon, sockets: [], source: "osm" },
    arriveSoc: 20,
    departSoc: 80,
    minDepartSoc: 60,
    chargeMinutes: 30,
    energyAddedKwh: 20,
    bestSocket: { connector: "ccs2", powerKw: 50, count: 1 },
    rangeGainKm: 100,
    kmAlongRoute: 150,
    fromRouteKm: 0,
    detourKm: 0,
    detourMinutes: 0,
    chargeKw: 50,
    kmToNext: 100,
    nextLabel: "Destino",
  };
}

describe("getGoogleMapsUrl", () => {
  it("incluye origen, destino y las paradas como waypoints", () => {
    const url = getGoogleMapsUrl(ORIGIN, DESTINATION, [STOP_POINT]);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.google.com/maps/dir/");
    expect(parsed.searchParams.get("api")).toBe("1");
    expect(parsed.searchParams.get("origin")).toBe("4.65,-74.1");
    expect(parsed.searchParams.get("destination")).toBe("6.25,-75.56");
    expect(parsed.searchParams.get("waypoints")).toBe("5.07,-75.52");
  });

  it("sin paradas no manda waypoints", () => {
    const url = getGoogleMapsUrl(ORIGIN, DESTINATION);
    expect(new URL(url).searchParams.has("waypoints")).toBe(false);
  });
});

describe("getWazeUrl / getAppleMapsUrl", () => {
  it("Waze manda un solo punto con navigate=yes", () => {
    const parsed = new URL(getWazeUrl(DESTINATION));
    expect(parsed.searchParams.get("ll")).toBe("6.25,-75.56");
    expect(parsed.searchParams.get("navigate")).toBe("yes");
  });

  it("Apple Maps manda un solo punto en daddr", () => {
    const parsed = new URL(getAppleMapsUrl(DESTINATION));
    expect(parsed.searchParams.get("daddr")).toBe("6.25,-75.56");
  });
});

describe("singleDestinationFor", () => {
  it("con paradas, apunta a la primera parada de carga", () => {
    expect(singleDestinationFor([stop()], DESTINATION)).toEqual(STOP_POINT);
  });

  it("sin paradas, apunta al destino final", () => {
    expect(singleDestinationFor([], DESTINATION)).toEqual(DESTINATION);
  });
});
