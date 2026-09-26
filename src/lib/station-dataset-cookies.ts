import type { StationDatasetLite } from "@/components/stations/use-station-dataset";

const COOKIE_NAME = "voltia_stations_dataset";
const COOKIE_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 horas

interface StoredDataset {
  data: StationDatasetLite;
  storedAt: number;
}

function isCookieValid(storedAt: number): boolean {
  const now = Date.now();
  return now - storedAt < COOKIE_EXPIRY_MS;
}

export function getCachedDataset(): StationDatasetLite | null {
  if (typeof window === "undefined") return null;
  try {
    const cookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith(COOKIE_NAME + "="));
    if (!cookie) return null;

    const value = cookie.split("=")[1];
    if (!value) return null;

    const stored = JSON.parse(decodeURIComponent(value)) as StoredDataset;
    if (!isCookieValid(stored.storedAt)) {
      // Cookie expirada, limpiar
      deleteCachedDataset();
      return null;
    }
    return stored.data;
  } catch {
    return null;
  }
}

export function setCachedDataset(data: StationDatasetLite): void {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredDataset = { data, storedAt: Date.now() };
    const expires = new Date(Date.now() + COOKIE_EXPIRY_MS).toUTCString();
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(stored))}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {
    // Silently fail if cookie too large or other issues
  }
}

export function deleteCachedDataset(): void {
  if (typeof window === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export function getRemainingCookieTime(): number {
  if (typeof window === "undefined") return 0;
  try {
    const cookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith(COOKIE_NAME + "="));
    if (!cookie) return 0;

    const value = cookie.split("=")[1];
    if (!value) return 0;

    const stored = JSON.parse(decodeURIComponent(value)) as StoredDataset;
    const remaining = COOKIE_EXPIRY_MS - (Date.now() - stored.storedAt);
    return Math.max(0, remaining);
  } catch {
    return 0;
  }
}
