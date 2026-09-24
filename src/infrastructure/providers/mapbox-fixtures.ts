/**
 * Rutas falsas con el formato de Mapbox Directions (steps=true) para tests:
 * cada tramo es [clase vial, km, minutos] y la geometría avanza hacia el sur.
 * Solo se usa en tests (excluido de la cobertura).
 */
export type FakeStretch = [cls: string, km: number, minutes: number];

export function fakeMapboxRoute(
  stretches: FakeStretch[],
  start = { lat: 7, lon: -73 },
  lonShift = 0,
) {
  const kmPerDegLat = 111.32;
  let lat = start.lat;
  const lon = start.lon + lonShift;
  const steps = stretches.map(([cls, km, minutes]) => {
    // Un vértice por km, con una intersección en el primero y otra a mitad.
    const n = Math.max(2, Math.round(km) + 1);
    const coords: [number, number][] = Array.from({ length: n }, (_, i) => [
      lon,
      lat - (km * i) / (n - 1) / kmPerDegLat,
    ]);
    lat -= km / kmPerDegLat;
    const mid = coords[Math.floor(n / 2)]!;
    return {
      distance: km * 1000,
      duration: minutes * 60,
      geometry: { coordinates: coords },
      intersections: [
        { location: coords[0]!, mapbox_streets_v8: { class: cls } },
        { location: mid, mapbox_streets_v8: { class: cls } },
      ],
    };
  });
  const allCoords = steps.flatMap((s, i) =>
    i === 0 ? s.geometry.coordinates : s.geometry.coordinates.slice(1),
  );
  return {
    distance: stretches.reduce((a, [, km]) => a + km * 1000, 0),
    duration: stretches.reduce((a, [, , m]) => a + m * 60, 0),
    geometry: { coordinates: allCoords },
    legs: [{ summary: "", distance: stretches.reduce((a, [, km]) => a + km * 1000, 0), steps }],
  };
}
