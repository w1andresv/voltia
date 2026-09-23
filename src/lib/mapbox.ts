const ENV_TOKEN = String(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();

/** Public Mapbox tokens are JWTs that start with `pk.` */
export function isMapboxPublicToken(value: string): boolean {
  return /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
}

export function envMapboxToken(): string {
  return isMapboxPublicToken(ENV_TOKEN) ? ENV_TOKEN : "";
}

export function mapboxTileUrl(token: string): string {
  const access = encodeURIComponent(token.trim());
  return `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/256/{z}/{x}/{y}?access_token=${access}`;
}

export const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
