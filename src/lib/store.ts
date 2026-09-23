import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildPlan, rankPlans } from "@/lib/domain/planner";
import { uniqueByProximity } from "@/lib/domain/geo";
import {
  DEFAULT_CONDITIONS,
  type Charger,
  type GeoBundle,
  type Place,
  type RoutePlan,
  type TripConditions,
  type Vehicle,
} from "@/lib/domain/types";
import { DEFAULT_VEHICLE_ID, VEHICLE_CATALOG, catalogById, isCatalogId } from "@/lib/domain/vehicles";
import { envMapboxToken, isMapboxPublicToken } from "@/lib/mapbox";
import { isPlugshareToken } from "@/lib/plugshare";

export const DEMO_TRIPS: { label: string; origin: Place; destination: Place }[] = [
  {
    label: "Piedecuesta → Villa de Leyva",
    origin: { label: "Piedecuesta, Santander", lat: 7.0833, lon: -73.0494 },
    destination: { label: "Villa de Leyva, Boyacá", lat: 5.6333, lon: -73.5256 },
  },
  {
    label: "Bogotá → Medellín",
    origin: { label: "Bogotá, Colombia", lat: 4.711, lon: -74.0721 },
    destination: { label: "Medellín, Antioquia", lat: 6.2442, lon: -75.5812 },
  },
  {
    label: "Madrid → Barcelona",
    origin: { label: "Madrid, España", lat: 40.4168, lon: -3.7038 },
    destination: { label: "Barcelona, España", lat: 41.3874, lon: 2.1686 },
  },
  {
    label: "Ciudad de México → Puebla",
    origin: { label: "Ciudad de México", lat: 19.4326, lon: -99.1332 },
    destination: { label: "Puebla, México", lat: 19.0414, lon: -98.2063 },
  },
];

interface PlannerState {
  vehicles: Vehicle[];
  selectedVehicleId: string;
  conditions: TripConditions;
  origin: Place | null;
  destination: Place | null;
  waypoints: Place[];
  geo: GeoBundle | null;
  plans: RoutePlan[];
  selectedPlanId: string | null;
  hoverKm: number | null;
  showAllChargers: boolean;
  vehicleModalOpen: boolean;
  settingsOpen: boolean;
  batteryOpen: boolean;
  stationsOpen: boolean;
  myTripsOpen: boolean;
  stationSeed: { lat: number; lon: number; address?: string; editId?: string } | null;
  mapClickArmed: "origin" | "destination" | "waypoint" | "station" | null;
  placeSearchOpen: boolean;
  mapboxToken: string;
  plugshareToken: string;
  mapBounds: { minLat: number; maxLat: number; minLon: number; maxLon: number; zoom: number } | null;
  setVehicleId: (id: string) => void;
  upsertVehicle: (v: Vehicle) => void;
  removeVehicle: (id: string) => void;
  resetVehicle: (id: string) => void;
  patchConditions: (p: Partial<TripConditions>) => void;
  setOrigin: (p: Place | null) => void;
  setDestination: (p: Place | null) => void;
  setWaypoints: (w: Place[]) => void;
  addChargerToRoute: (c: Charger) => "origin" | "destination" | "waypoint" | "full";
  swapEnds: () => void;
  applyDemo: (trip: (typeof DEMO_TRIPS)[number]) => void;
  applySavedRequest: (req: { origin: Place; destination: Place; waypoints: Place[]; vehicle: Vehicle; conditions: TripConditions }) => void;
  setResult: (geo: GeoBundle, plans: RoutePlan[], selectedId: string) => void;
  selectPlan: (id: string) => void;
  setHoverKm: (km: number | null) => void;
  setShowAllChargers: (v: boolean) => void;
  setVehicleModalOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setBatteryOpen: (v: boolean) => void;
  setStationsOpen: (v: boolean) => void;
  setMyTripsOpen: (v: boolean) => void;
  setStationSeed: (v: PlannerState["stationSeed"]) => void;
  injectCharger: (c: Charger) => void;
  setMapClickArmed: (v: PlannerState["mapClickArmed"]) => void;
  setPlaceSearchOpen: (v: boolean) => void;
  setMapboxToken: (token: string) => void;
  setPlugshareToken: (token: string) => void;
  setMapBounds: (b: PlannerState["mapBounds"]) => void;
  clearTrip: () => void;
  selectedVehicle: () => Vehicle;
  selectedPlan: () => RoutePlan | null;
  nearbyChargers: () => Charger[];
}

function clampTripRegen(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 20;
  return Math.min(80, Math.max(5, v));
}

function mergeVehicles(stored: Vehicle[] | undefined): Vehicle[] {
  const storedList = stored ?? [];
  const storedById = new Map(storedList.map((v) => [v.id, v]));
  const result: Vehicle[] = [];
  const seen = new Set<string>();

  for (const factory of VEHICLE_CATALOG) {
    const edited = storedById.get(factory.id);
    result.push(
      edited
        ? {
            ...factory,
            ...edited,
            id: factory.id,
            consumptionKwhPer100km: edited.consumptionManual ? edited.consumptionKwhPer100km : factory.consumptionKwhPer100km,
            consumptionManual: Boolean(edited.consumptionManual),
          }
        : factory,
    );
    seen.add(factory.id);
  }
  for (const v of storedList) {
    if (seen.has(v.id)) continue;
    result.push({
      ...v,
      consumptionKwhPer100km: v.consumptionManual ? v.consumptionKwhPer100km : null,
      consumptionManual: Boolean(v.consumptionManual),
    });
  }
  return result;
}

function withRecomputedPlans(s: PlannerState): Pick<PlannerState, "plans" | "selectedPlanId"> | Record<string, never> {
  const geo = s.geo;
  const origin = s.origin;
  const destination = s.destination;
  if (!geo?.routes.length || !origin || !destination) return {};
  const vehicle = s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? VEHICLE_CATALOG[0]!;
  const built = geo.routes.map((raw) =>
    buildPlan({
      raw,
      vehicle,
      conditions: s.conditions,
      chargers: geo.chargers,
      weather: geo.weather,
      origin,
      destination,
    }),
  );
  const ranked = rankPlans(built, s.conditions.planningMode);
  return { plans: ranked, selectedPlanId: ranked[0]?.id ?? null };
}

export const usePlanner = create<PlannerState>()(
  persist(
    (set, get) => ({
      vehicles: VEHICLE_CATALOG,
      selectedVehicleId: DEFAULT_VEHICLE_ID,
      conditions: DEFAULT_CONDITIONS,
      origin: null,
      destination: null,
      waypoints: [],
      geo: null,
      plans: [],
      selectedPlanId: null,
      hoverKm: null,
      showAllChargers: true,
      vehicleModalOpen: false,
      settingsOpen: false,
      batteryOpen: false,
      stationsOpen: false,
      myTripsOpen: false,
      stationSeed: null,
      mapClickArmed: null,
      placeSearchOpen: false,
      mapboxToken: envMapboxToken(),
      // Sin valor por defecto: cada quien pega su propia clave en Configuración
      // > PlugShare si quiere (ver src/lib/plugshare.ts).
      plugshareToken: "",
      mapBounds: null,
      setVehicleId: (id) =>
        set((s) => {
          const next = { ...s, selectedVehicleId: id };
          return { selectedVehicleId: id, ...withRecomputedPlans(next) };
        }),
      upsertVehicle: (v) =>
        set((s) => {
          const i = s.vehicles.findIndex((x) => x.id === v.id);
          const vehicles = i >= 0 ? s.vehicles.map((x) => (x.id === v.id ? v : x)) : [...s.vehicles, v];
          const next = { ...s, vehicles, selectedVehicleId: v.id };
          return { vehicles, selectedVehicleId: v.id, ...withRecomputedPlans(next) };
        }),
      removeVehicle: (id) =>
        set((s) => {
          if (isCatalogId(id)) return {};
          const vehicles = s.vehicles.filter((v) => v.id !== id);
          const selectedVehicleId =
            s.selectedVehicleId === id ? (vehicles[0]?.id ?? DEFAULT_VEHICLE_ID) : s.selectedVehicleId;
          const next = { ...s, vehicles, selectedVehicleId };
          return { vehicles, selectedVehicleId, ...withRecomputedPlans(next) };
        }),
      resetVehicle: (id) =>
        set((s) => {
          const factory = catalogById(id);
          if (!factory) return {};
          const vehicles = s.vehicles.map((v) => (v.id === id ? factory : v));
          const next = { ...s, vehicles };
          return { vehicles, ...withRecomputedPlans(next) };
        }),
      patchConditions: (p) =>
        set((s) => {
          const conditions = {
            ...s.conditions,
            ...p,
            regenPct: p.regenPct != null ? clampTripRegen(p.regenPct) : s.conditions.regenPct,
          };
          const next = { ...s, conditions };
          return { conditions, ...withRecomputedPlans(next) };
        }),
      setOrigin: (p) => set({ origin: p, plans: [], geo: null, selectedPlanId: null }),
      setDestination: (p) => set({ destination: p, plans: [], geo: null, selectedPlanId: null }),
      setWaypoints: (w) => set({ waypoints: w, plans: [], geo: null, selectedPlanId: null }),
      addChargerToRoute: (c) => {
        const place: Place = { label: c.name, lat: c.lat, lon: c.lon, context: c.operator };
        const s = get();
        if (!s.origin) {
          set({ origin: place, plans: [], geo: null, selectedPlanId: null });
          return "origin";
        }
        if (!s.destination) {
          set({ destination: place, plans: [], geo: null, selectedPlanId: null });
          return "destination";
        }
        if (s.waypoints.length >= 3) return "full";
        set({
          waypoints: [...s.waypoints, place],
          plans: [],
          geo: null,
          selectedPlanId: null,
        });
        return "waypoint";
      },
      swapEnds: () =>
        set((s) => ({
          origin: s.destination,
          destination: s.origin,
          plans: [],
          geo: null,
          selectedPlanId: null,
        })),
      applyDemo: (trip) =>
        set({
          origin: trip.origin,
          destination: trip.destination,
          waypoints: [],
          plans: [],
          geo: null,
          selectedPlanId: null,
        }),
      applySavedRequest: (req) =>
        set((s) => {
          const i = s.vehicles.findIndex((v) => v.id === req.vehicle.id);
          const vehicles = i >= 0 ? s.vehicles.map((v, idx) => (idx === i ? req.vehicle : v)) : [...s.vehicles, req.vehicle];
          return {
            origin: req.origin,
            destination: req.destination,
            waypoints: req.waypoints,
            vehicles,
            selectedVehicleId: req.vehicle.id,
            conditions: req.conditions,
            plans: [],
            geo: null,
            selectedPlanId: null,
            myTripsOpen: false,
          };
        }),
      setResult: (geo, plans, selectedId) => set({ geo, plans, selectedPlanId: selectedId, hoverKm: null }),
      selectPlan: (id) => set({ selectedPlanId: id, hoverKm: null }),
      setHoverKm: (km) => set({ hoverKm: km }),
      setShowAllChargers: (v) => set({ showAllChargers: v }),
      setVehicleModalOpen: (v) => set({ vehicleModalOpen: v }),
      setSettingsOpen: (v) => set({ settingsOpen: v }),
      setBatteryOpen: (v) => set({ batteryOpen: v }),
      setStationsOpen: (v) => set({ stationsOpen: v }),
      setMyTripsOpen: (v) => set({ myTripsOpen: v }),
      setStationSeed: (v) => set({ stationSeed: v }),
      injectCharger: (c) =>
        set((s) => {
          if (c.status === "rejected") {
            const geo = s.geo
              ? { ...s.geo, chargers: s.geo.chargers.filter((x) => x.id !== c.id) }
              : s.geo;
            if (!geo) return {};
            const next = { ...s, geo };
            return { geo, ...withRecomputedPlans(next) };
          }
          const geo = s.geo;
          if (!geo) return {};
          const chargers = uniqueByProximity([c, ...geo.chargers.filter((x) => x.id !== c.id)], 0.15);
          const nextGeo = { ...geo, chargers };
          const next = { ...s, geo: nextGeo };
          return { geo: nextGeo, ...withRecomputedPlans(next) };
        }),
      setMapClickArmed: (v) => set({ mapClickArmed: v }),
      setPlaceSearchOpen: (v) => set({ placeSearchOpen: v }),
      setMapboxToken: (token) => set({ mapboxToken: token.trim() }),
      setPlugshareToken: (token) => set({ plugshareToken: token.trim() }),
      setMapBounds: (b) =>
        set((s) => {
          if (!b) return { mapBounds: null };
          const p = s.mapBounds;
          if (
            p &&
            Math.abs(p.minLat - b.minLat) < 0.008 &&
            Math.abs(p.maxLat - b.maxLat) < 0.008 &&
            Math.abs(p.minLon - b.minLon) < 0.008 &&
            Math.abs(p.maxLon - b.maxLon) < 0.008 &&
            p.zoom === b.zoom
          ) {
            return {};
          }
          return { mapBounds: b };
        }),
      clearTrip: () =>
        set({
          origin: null,
          destination: null,
          waypoints: [],
          plans: [],
          geo: null,
          selectedPlanId: null,
          hoverKm: null,
        }),
      selectedVehicle: () => {
        const s = get();
        return s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? VEHICLE_CATALOG[0]!;
      },
      selectedPlan: () => {
        const s = get();
        return s.plans.find((p) => p.id === s.selectedPlanId) ?? s.plans[0] ?? null;
      },
      nearbyChargers: () => get().geo?.chargers ?? [],
    }),
    {
      name: "voltia-planner",
      partialize: (s) => ({
        vehicles: s.vehicles,
        selectedVehicleId: s.selectedVehicleId,
        conditions: s.conditions,
        mapboxToken: s.mapboxToken,
        plugshareToken: s.plugshareToken,
        tripRegenV: 2,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlannerState> & { tripRegenV?: number };
        const storedToken = (p.mapboxToken ?? "").trim();
        const storedPlugshare = (p.plugshareToken ?? "").trim();
        const storedConditions = p.conditions;
        const regenPct = p.tripRegenV === 2 ? clampTripRegen(storedConditions?.regenPct) : 20;
        return {
          ...current,
          ...p,
          vehicles: mergeVehicles(p.vehicles),
          conditions: { ...DEFAULT_CONDITIONS, ...(storedConditions ?? {}), regenPct },
          mapboxToken: isMapboxPublicToken(storedToken) ? storedToken : current.mapboxToken,
          plugshareToken: isPlugshareToken(storedPlugshare) ? storedPlugshare : current.plugshareToken,
          mapBounds: null,
        };
      },
    },
  ),
);
