import { create } from "zustand";
import { persist } from "zustand/middleware";
import { computePlansFromSnapshot, type SnapshotInputs } from "@/domain/ev/compute-plan";
import { uniqueByProximity } from "@/domain/geo";
import {
  DEFAULT_CONDITIONS,
  type Charger,
  type GeoBundle,
  type Place,
  type RoutePlan,
  type TripConditions,
  type Vehicle,
} from "@/domain/types";
import { DEFAULT_VEHICLE_ID, VEHICLE_CATALOG } from "@/domain/vehicles";
import { LEGACY_V2_CATALOG } from "@/domain/legacy-catalog";
import { RegenLevelSchema, regenLevelFromLegacyPct } from "@/domain/schemas";
import { extractOwnVehicles } from "@/domain/user/catalog-rules";
import { createGuestStorage, MAX_GUEST_VEHICLES } from "@/infrastructure/user-data/guest-storage";
import type { LastTrip } from "./last-trip";
import { throttle } from "./throttle";

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
  /**
   * Lista en memoria (NO se persiste): catálogo + vehículos propios del usuario
   * activo, la mantiene UserDataProvider. La fuente de verdad de los propios
   * es el repositorio del contexto (navegador o servidor), no este store.
   */
  vehicles: Vehicle[];
  /** Vehículo de una ruta guardada/compartida que no está en la lista del usuario; no se persiste. */
  tempVehicle: Vehicle | null;
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
  /**
   * Motor del planificador: lo fija la URL (/v1 o /v2) al abrirlo y se guarda
   * para volver al último usado. null: todavía no se abrió ninguno.
   */
  engineChoice: "v1" | "v2" | null;
  setEngineChoice: (choice: "v1" | "v2" | null) => void;
  stationSeed: { lat: number; lon: number; address?: string; editId?: string } | null;
  mapClickArmed: "origin" | "destination" | "waypoint" | "station" | null;
  placeSearchOpen: boolean;
  mapBounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    zoom: number;
  } | null;
  setVehicleId: (id: string) => void;
  /** Reemplaza la lista de vehículos (catálogo + propios) y corrige la selección si ya no existe. */
  setVehicles: (list: Vehicle[]) => void;
  patchConditions: (p: Partial<TripConditions>) => void;
  setOrigin: (p: Place | null) => void;
  setDestination: (p: Place | null) => void;
  setWaypoints: (w: Place[]) => void;
  addChargerToRoute: (c: Charger) => "origin" | "destination" | "waypoint" | "full";
  swapEnds: () => void;
  applyDemo: (trip: (typeof DEMO_TRIPS)[number]) => void;
  applySavedRequest: (req: {
    origin: Place;
    destination: Place;
    waypoints: Place[];
    vehicle: Vehicle;
    conditions: TripConditions;
  }) => void;
  /**
   * Vuelve a mostrar el último plan guardado en el navegador (sin conexión):
   * los planes se recalculan con su `geo`, sin consultar proveedores.
   */
  restoreTrip: (trip: LastTrip) => void;
  setResult: (geo: GeoBundle, plans: RoutePlan[], selectedId: string) => void;
  /** Quita el plan calculado (sin tocar origen, destino ni preferencias). */
  clearResult: () => void;
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
  setMapBounds: (b: PlannerState["mapBounds"]) => void;
  clearTrip: () => void;
  selectedVehicle: () => Vehicle;
  selectedPlan: () => RoutePlan | null;
  nearbyChargers: () => Charger[];
}

/**
 * Nivel de regeneración de las condiciones guardadas. Con `tripRegenV` 3 ya se
 * guarda el nivel; con 2 venía un porcentaje (`regenPct`) que se traduce; antes
 * de eso el valor no era confiable y se usa el de por defecto. Exportada para probarla.
 */
export function storedRegenLevel(
  conditions: unknown,
  version: number | undefined,
): TripConditions["regenLevel"] {
  const c = (conditions ?? {}) as { regenLevel?: unknown; regenPct?: unknown };
  const level = RegenLevelSchema.safeParse(c.regenLevel);
  if (level.success) return level.data;
  if (version === 2) return regenLevelFromLegacyPct(c.regenPct);
  return DEFAULT_CONDITIONS.regenLevel;
}

type PlanInputs = Pick<
  PlannerState,
  "geo" | "origin" | "destination" | "vehicles" | "selectedVehicleId" | "conditions"
>;

/** Planes (ya ordenados) de las rutas calculadas, con estas condiciones. Sin volver a pedir rutas. */
export function rankedPlansFor(
  s: PlanInputs,
  conditions: TripConditions = s.conditions,
): RoutePlan[] {
  const geo = s.geo;
  const origin = s.origin;
  const destination = s.destination;
  if (!geo?.routes.length || !origin || !destination) return [];
  const vehicle = s.vehicles.find((v) => v.id === s.selectedVehicleId) ?? VEHICLE_CATALOG[0]!;
  // El `geo` es el snapshot que respondió el servidor: si trae la pasada 2, se conserva.
  return computePlansFromSnapshot(geo as SnapshotInputs, { origin, destination }, vehicle, conditions)
    .plans;
}

/**
 * El vehículo de una ruta guardada: si no está en la lista del usuario ni en
 * el catálogo, se usa como temporal (no se persiste ni entra a su lista).
 */
function withTripVehicle(
  s: Pick<PlannerState, "vehicles" | "tempVehicle">,
  vehicle: Vehicle,
): Pick<PlannerState, "vehicles" | "tempVehicle" | "selectedVehicleId"> {
  const known = s.vehicles.some((v) => v.id === vehicle.id);
  return {
    vehicles: known
      ? s.vehicles
      : [...s.vehicles.filter((v) => v.id !== s.tempVehicle?.id), vehicle],
    tempVehicle: known ? null : vehicle,
    selectedVehicleId: vehicle.id,
  };
}

/** Plazo entre recálculos mientras se arrastra un control de condiciones. */
export const RECOMPUTE_THROTTLE_MS = 150;

/** Recálculo de las condiciones, con retraso (ver `patchConditions`). Se asigna al crear el store. */
let conditionsRecompute: ReturnType<typeof throttle> | null = null;

function withRecomputedPlans(
  s: PlannerState,
): Pick<PlannerState, "plans" | "selectedPlanId"> | Record<string, never> {
  // Este recálculo ya cubre cualquiera pendiente por cambio de condiciones.
  conditionsRecompute?.cancel();
  const ranked = rankedPlansFor(s);
  if (!ranked.length) return {};
  return { plans: ranked, selectedPlanId: ranked[0]?.id ?? null };
}

export const usePlanner = create<PlannerState>()(
  persist(
    (set, get) => ({
      vehicles: VEHICLE_CATALOG,
      tempVehicle: null,
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
      engineChoice: null,
      stationSeed: null,
      mapClickArmed: null,
      placeSearchOpen: false,
      mapBounds: null,
      setVehicleId: (id) =>
        set((s) => {
          const tempVehicle = s.tempVehicle?.id === id ? s.tempVehicle : null;
          const next = { ...s, selectedVehicleId: id, tempVehicle };
          return { selectedVehicleId: id, tempVehicle, ...withRecomputedPlans(next) };
        }),
      setVehicles: (list) =>
        set((s) => {
          const temp =
            s.tempVehicle && !list.some((v) => v.id === s.tempVehicle!.id) ? s.tempVehicle : null;
          const vehicles = temp ? [...list, temp] : list;
          const selectedVehicleId = vehicles.some((v) => v.id === s.selectedVehicleId)
            ? s.selectedVehicleId
            : (vehicles.find((v) => v.id === DEFAULT_VEHICLE_ID)?.id ??
              vehicles[0]?.id ??
              DEFAULT_VEHICLE_ID);
          const next = { ...s, vehicles, selectedVehicleId, tempVehicle: temp };
          return { vehicles, selectedVehicleId, tempVehicle: temp, ...withRecomputedPlans(next) };
        }),
      // Las condiciones cambian enseguida; los planes se recalculan con `throttle`
      // para que arrastrar un control no recalcule todas las rutas en cada paso.
      patchConditions: (p) => {
        set((s) => ({ conditions: { ...s.conditions, ...p } }));
        if (!get().geo) return;
        conditionsRecompute ??= throttle(
          () => set((s) => withRecomputedPlans(s)),
          RECOMPUTE_THROTTLE_MS,
        );
        conditionsRecompute.run();
      },
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
        set((s) => ({
          origin: req.origin,
          destination: req.destination,
          waypoints: req.waypoints,
          ...withTripVehicle(s, req.vehicle),
          conditions: req.conditions,
          plans: [],
          geo: null,
          selectedPlanId: null,
          myTripsOpen: false,
        })),
      restoreTrip: (trip) =>
        set((s) => {
          conditionsRecompute?.cancel();
          const next = {
            ...s,
            origin: trip.origin,
            destination: trip.destination,
            waypoints: trip.waypoints,
            ...withTripVehicle(s, trip.vehicle),
            conditions: trip.conditions,
            geo: trip.geo,
          };
          const plans = rankedPlansFor(next);
          const selectedPlanId = plans.some((p) => p.id === trip.selectedPlanId)
            ? trip.selectedPlanId
            : (plans[0]?.id ?? null);
          return {
            origin: next.origin,
            destination: next.destination,
            waypoints: next.waypoints,
            vehicles: next.vehicles,
            tempVehicle: next.tempVehicle,
            selectedVehicleId: next.selectedVehicleId,
            conditions: next.conditions,
            geo: next.geo,
            plans,
            selectedPlanId,
            hoverKm: null,
          };
        }),
      setResult: (geo, plans, selectedId) => {
        conditionsRecompute?.cancel();
        set({ geo, plans, selectedPlanId: selectedId, hoverKm: null });
      },
      clearResult: () => {
        conditionsRecompute?.cancel();
        set({ geo: null, plans: [], selectedPlanId: null, hoverKm: null });
      },
      selectPlan: (id) => set({ selectedPlanId: id, hoverKm: null }),
      setHoverKm: (km) => set({ hoverKm: km }),
      setShowAllChargers: (v) => set({ showAllChargers: v }),
      setVehicleModalOpen: (v) => set({ vehicleModalOpen: v }),
      setSettingsOpen: (v) => set({ settingsOpen: v }),
      setBatteryOpen: (v) => set({ batteryOpen: v }),
      setStationsOpen: (v) => set({ stationsOpen: v }),
      setMyTripsOpen: (v) => set({ myTripsOpen: v }),
      setEngineChoice: (choice) => set({ engineChoice: choice }),
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
          const chargers = uniqueByProximity(
            [c, ...geo.chargers.filter((x) => x.id !== c.id)],
            0.15,
          );
          const nextGeo = { ...geo, chargers };
          const next = { ...s, geo: nextGeo };
          return { geo: nextGeo, ...withRecomputedPlans(next) };
        }),
      setMapClickArmed: (v) => set({ mapClickArmed: v }),
      setPlaceSearchOpen: (v) => set({ placeSearchOpen: v }),
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
      // v3: la lista de vehículos y el token de PlugShare salen del navegador
      // (los propios pasan a `voltia-guest`); aquí quedan solo las preferencias.
      version: 3,
      partialize: (s) => ({
        selectedVehicleId: s.selectedVehicleId,
        conditions: s.conditions,
        engineChoice: s.engineChoice,
        tripRegenV: 3,
      }),
      migrate: (persisted) => migratePlannerState(persisted),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlannerState> & { tripRegenV?: number };
        const storedConditions = p.conditions;
        const regenLevel = storedRegenLevel(storedConditions, p.tripRegenV);
        const { regenPct: _legacyRegen, ...restConditions } = (storedConditions ??
          {}) as Partial<TripConditions> & { regenPct?: unknown };
        void _legacyRegen;
        return {
          ...current,
          selectedVehicleId:
            typeof p.selectedVehicleId === "string"
              ? p.selectedVehicleId
              : current.selectedVehicleId,
          conditions: { ...DEFAULT_CONDITIONS, ...restConditions, regenLevel },
          engineChoice: p.engineChoice === "v1" || p.engineChoice === "v2" ? p.engineChoice : null,
          mapBounds: null,
        };
      },
    },
  ),
);

/**
 * Migración v2 → v3 del estado guardado. Mueve los vehículos propios
 * (personalizados o ediciones reales de catálogo) a `voltia-guest`, descarta el
 * catálogo y el token de PlugShare (una credencial que no debe vivir en el
 * navegador) y deja solo las preferencias. Exportada para probarla.
 */
export function migratePlannerState(persisted: unknown): Record<string, unknown> {
  const p = (persisted ?? {}) as Record<string, unknown>;
  const { vehicles, plugshareToken: _dropped, ...rest } = p;
  void _dropped;
  if (Array.isArray(vehicles)) {
    try {
      const own = extractOwnVehicles(vehicles as Vehicle[], LEGACY_V2_CATALOG).slice(
        0,
        MAX_GUEST_VEHICLES,
      );
      const guest = createGuestStorage();
      for (const v of own) guest.addVehicle(v);
    } catch (error) {
      console.error("[store] no se pudieron mover los vehículos a voltia-guest", error);
    }
  }
  return rest;
}
