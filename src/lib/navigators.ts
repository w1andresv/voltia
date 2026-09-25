import type { ChargeStop, LatLon } from "@/domain/types";

function coordParam(p: LatLon): string {
  return `${p.lat},${p.lon}`;
}

/** https://developers.google.com/maps/documentation/urls/get-started#directions-action */
export function getGoogleMapsUrl(origin: LatLon, destination: LatLon, waypoints: LatLon[] = []): string {
  const params = new URLSearchParams({
    api: "1",
    origin: coordParam(origin),
    destination: coordParam(destination),
  });
  if (waypoints.length) params.set("waypoints", waypoints.map(coordParam).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Waze solo acepta un destino por enlace. */
export function getWazeUrl(point: LatLon): string {
  const params = new URLSearchParams({ ll: coordParam(point), navigate: "yes" });
  return `https://waze.com/ul?${params.toString()}`;
}

/** Apple Maps tampoco soporta varias paradas por enlace. */
export function getAppleMapsUrl(point: LatLon): string {
  const params = new URLSearchParams({ daddr: coordParam(point) });
  return `https://maps.apple.com/?${params.toString()}`;
}

/** Con paradas de carga, Waze/Apple Maps navegan a la próxima; sin paradas, al destino. */
export function singleDestinationFor(stops: ChargeStop[], destination: LatLon): LatLon {
  const next = stops[0]?.charger;
  return next ? { lat: next.lat, lon: next.lon } : destination;
}
