import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Flag, MapPin, Zap } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import type { Charger, LatLon, RouteSample } from "@/domain/types";
import { MAP_COLORS, socColor } from "@/lib/map-colors";
import { formatKm, formatKwh, formatKw, formatMinutes, formatPct } from "@/lib/format";
import { ChargerFacts } from "@/components/planner/charger-facts";
import { suppressMapClicks } from "@/components/planner/map-click";
import { MAPBOX_ATTRIBUTION, mapboxTileUrl } from "@/lib/mapbox";
import { usePlanner } from "@/lib/store";
import type { ChargerAction, LeafletMapProps, MapBounds } from "./map-types";

export type { LeafletMapProps };

function pinIcon(kind: "origin" | "dest" | "charger" | "pending") {
  const bg =
    kind === "origin" ? MAP_COLORS.origin : kind === "pending" ? MAP_COLORS.socMid : MAP_COLORS.dest;
  const fg = kind === "origin" ? "#0b0e12" : kind === "pending" ? "#2a2114" : "#06221d";
  const node =
    kind === "origin" ? (
      <MapPin size={14} color={fg} strokeWidth={2.4} />
    ) : kind === "dest" ? (
      <Flag size={14} color={fg} strokeWidth={2.4} />
    ) : (
      <Zap size={13} color={fg} strokeWidth={2.4} />
    );
  const html = renderToStaticMarkup(
    <div className="voltia-pin" style={{ background: bg, width: 28, height: 28 }}>
      {node}
    </div>,
  );
  return L.divIcon({
    className: "voltia-marker",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function stopIcon(n: number) {
  const html = renderToStaticMarkup(
    <div
      className="voltia-pin"
      style={{
        background: MAP_COLORS.dest,
        width: 32,
        height: 32,
        boxShadow: "0 0 0 3px rgb(61 222 200 / 0.35), 0 8px 16px -10px rgb(0 0 0 / 0.7)",
      }}
    >
      <span style={{ color: "#06221d", fontWeight: 700, fontSize: 13, lineHeight: 1 }}>{n}</span>
    </div>,
  );
  return L.divIcon({
    className: "voltia-marker",
    html,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const ICONS = {
  origin: pinIcon("origin"),
  dest: pinIcon("dest"),
  charger: pinIcon("charger"),
  pending: pinIcon("pending"),
};

function Fit({ points }: { points: LatLon[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join("|");
  useEffect(() => {
    if (points.length === 1) {
      const p = points[0]!;
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 11), { animate: false });
      return;
    }
    if (points.length < 2) return;
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
    map.fitBounds(b, { padding: [56, 56], maxZoom: 11, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function Ready() {
  const map = useMap();
  useEffect(() => {
    const sync = () => map.invalidateSize();
    const id = window.setTimeout(sync, 40);
    const el = map.getContainer();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      window.clearTimeout(id);
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [map]);
  return null;
}

function InteractionLock({ locked }: { locked: boolean }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    if (locked) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      container.style.pointerEvents = "none";
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      container.style.pointerEvents = "";
    }
    return () => {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      container.style.pointerEvents = "";
    };
  }, [map, locked]);
  return null;
}

function ClickTrap({
  enabled,
  onMapClick,
}: {
  enabled: boolean;
  onMapClick: (lat: number, lon: number) => void;
}) {
  const map = useMap();
  const fn = useRef(onMapClick);
  fn.current = onMapClick;
  useEffect(() => {
    map.getContainer().style.cursor = enabled ? "crosshair" : "";
  }, [map, enabled]);
  useMapEvents({
    click(e) {
      if (!enabled) return;
      fn.current(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function HoverTrap({
  samples,
  onHoverKm,
}: {
  samples: RouteSample[];
  onHoverKm: (km: number | null) => void;
}) {
  const fn = useRef(onHoverKm);
  fn.current = onHoverKm;
  const last = useRef<number | null>(null);
  const raf = useRef(0);
  useMapEvents({
    mousemove(e) {
      if (!samples.length) return;
      if (raf.current) return;
      const latlng = e.latlng;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        let min = Infinity;
        let km: number | null = null;
        for (const s of samples) {
          const d = latlng.distanceTo([s.lat, s.lon]);
          if (d < min) {
            min = d;
            km = s.km;
          }
        }
        const next = min < 28000 ? km : null;
        if (next !== last.current) {
          last.current = next;
          fn.current(next);
        }
      });
    },
    mouseout() {
      if (last.current != null) {
        last.current = null;
        fn.current(null);
      }
    },
  });
  return null;
}

function sampleAt(samples: RouteSample[], km: number): RouteSample | null {
  if (!samples.length) return null;
  let best = samples[0]!;
  let min = Math.abs(best.km - km);
  for (const s of samples) {
    const d = Math.abs(s.km - km);
    if (d < min) {
      min = d;
      best = s;
    }
  }
  return best;
}

function coloredSegments(samples: RouteSample[]): { positions: [number, number][]; color: string }[] {
  const segs: { positions: [number, number][]; color: string }[] = [];
  if (samples.length < 2) return segs;
  let current: [number, number][] = [[samples[0]!.lat, samples[0]!.lon]];
  let color = socColor(samples[0]!.soc);
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    const c = socColor(s.soc);
    current.push([s.lat, s.lon]);
    if (c !== color) {
      segs.push({ positions: current, color });
      current = [[s.lat, s.lon]];
      color = c;
    }
  }
  if (current.length > 1) segs.push({ positions: current, color });
  return segs;
}

function ChargerPopup({ charger, action }: { charger: Charger; action: ChargerAction }) {
  const setSeed = usePlanner((s) => s.setStationSeed);
  const addToRoute = usePlanner((s) => s.addChargerToRoute);
  return (
    <div className="min-w-40 text-sm">
      <ChargerFacts charger={charger} compact />
      <div className="mt-2 flex flex-wrap gap-2">
        {action === "plan" ? (
          <button
            type="button"
            className="h-11 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
            onClick={() => {
              suppressMapClicks(900);
              const slot = addToRoute(charger);
              if (slot === "full") toast.error("Ya hay tres paradas en la ruta");
              else if (slot === "origin") toast.success("Origen fijado desde el mapa");
              else if (slot === "destination") toast.success("Destino fijado desde el mapa");
              else toast.success("Electrolinera añadida como parada");
            }}
          >
            Añadir a la ruta
          </button>
        ) : null}
        {action !== "browse" && charger.source === "community" ? (
          <button
            type="button"
            className="h-11 text-sm text-muted"
            onClick={() => {
              suppressMapClicks(900);
              setSeed({ lat: charger.lat, lon: charger.lon, address: charger.address, editId: charger.id });
            }}
          >
            Editar ficha
          </button>
        ) : null}
      </div>
    </div>
  );
}

function cullChargers(chargers: Charger[], bounds: L.LatLngBounds, zoom: number): Charger[] {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const padLat = Math.max(0.08, (ne.lat - sw.lat) * 0.18);
  const padLon = Math.max(0.08, (ne.lng - sw.lng) * 0.18);
  const minLat = sw.lat - padLat;
  const maxLat = ne.lat + padLat;
  const minLon = sw.lng - padLon;
  const maxLon = ne.lng + padLon;
  const pending: Charger[] = [];
  const rest: Charger[] = [];
  for (const c of chargers) {
    if (c.lat < minLat || c.lat > maxLat || c.lon < minLon || c.lon > maxLon) continue;
    if (c.status === "pending") pending.push(c);
    else rest.push(c);
  }
  const max = zoom >= 11 ? 280 : zoom >= 8 ? 140 : zoom >= 6 ? 70 : 36;
  if (rest.length <= max) return pending.concat(rest);
  const step = Math.ceil(rest.length / max);
  const sampled: Charger[] = [];
  for (let i = 0; i < rest.length && sampled.length < max; i += step) sampled.push(rest[i]!);
  return pending.concat(sampled);
}

function ChargerDots({
  chargers,
  action,
}: {
  chargers: Charger[];
  action: ChargerAction;
}) {
  const map = useMap();
  const [view, setView] = useState(() => ({ bounds: map.getBounds(), zoom: map.getZoom() }));
  const [picked, setPicked] = useState<Charger | null>(null);

  useEffect(() => {
    setPicked(null);
  }, [action]);

  useMapEvents({
    moveend() {
      setView({ bounds: map.getBounds(), zoom: map.getZoom() });
    },
    zoomend() {
      setView({ bounds: map.getBounds(), zoom: map.getZoom() });
    },
  });

  const dots = useMemo(
    () => cullChargers(chargers, view.bounds, view.zoom),
    [chargers, view],
  );

  return (
    <>
      {dots.map((c) => (
        <Marker
          key={c.id}
          position={[c.lat, c.lon]}
          icon={c.status === "pending" ? ICONS.pending : ICONS.charger}
          eventHandlers={{ click: () => setPicked(c) }}
        />
      ))}
      {picked ? (
        <Popup
          position={[picked.lat, picked.lon]}
          eventHandlers={{ remove: () => setPicked(null) }}
        >
          <ChargerPopup charger={picked} action={action} />
        </Popup>
      ) : null}
    </>
  );
}

function BoundsReporter({ onChange }: { onChange?: (b: MapBounds) => void }) {
  const map = useMap();
  const cb = useRef(onChange);
  cb.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = () => {
    const fn = cb.current;
    if (!fn) return;
    const b = map.getBounds();
    fn({
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLon: b.getWest(),
      maxLon: b.getEast(),
      zoom: map.getZoom(),
    });
  };

  useEffect(() => {
    emit();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [map]);

  useMapEvents({
    moveend() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(emit, 480);
    },
  });
  return null;
}

function MapboxTiles({ token }: { token: string }) {
  const setToken = usePlanner((s) => s.setMapboxToken);
  const fails = useRef(0);
  useEffect(() => {
    fails.current = 0;
  }, [token]);
  useMapEvents({
    tileerror() {
      fails.current += 1;
      if (fails.current === 6) {
        toast.error("Mapbox rechazó el token. Pégalo de nuevo.");
        setToken("");
      }
    },
  });
  return (
    <TileLayer
      attribution={MAPBOX_ATTRIBUTION}
      url={mapboxTileUrl(token)}
      tileSize={256}
      maxZoom={22}
      keepBuffer={2}
      updateWhenZooming={false}
      updateWhenIdle
    />
  );
}

export function LeafletMap({
  origin,
  destination,
  plan,
  alternatives = [],
  onSelectRoute,
  chargers,
  showAllChargers,
  hoverKm,
  onHoverKm,
  onMapClick,
  mapClickEnabled,
  mapLocked,
  chargerAction = "browse",
  onViewChange,
}: LeafletMapProps) {
  const mapboxToken = usePlanner((s) => s.mapboxToken);
  const fitPoints = useMemo(() => {
    // Encuadra todas las rutas encontradas, así elegir otra no mueve el mapa.
    if (plan?.geometry.length) return [...plan.geometry, ...alternatives.flatMap((a) => a.geometry)];
    const pts: LatLon[] = [];
    if (origin) pts.push(origin);
    if (destination) pts.push(destination);
    return pts;
  }, [plan, alternatives, origin, destination]);

  const segs = useMemo(() => (plan ? coloredSegments(plan.samples) : []), [plan]);
  const hover = plan && hoverKm != null ? sampleAt(plan.samples, hoverKm) : null;
  const extras = useMemo(() => {
    if (!showAllChargers) return [];
    const stopIds = new Set(plan?.stops.map((s) => s.charger.id) ?? []);
    return chargers.filter((c) => !stopIds.has(c.id));
  }, [showAllChargers, chargers, plan]);

  return (
    <MapContainer
      center={[4.7, -74.1]}
      zoom={6}
      className="absolute inset-0 h-full w-full"
      zoomControl={false}
      attributionControl
      fadeAnimation={false}
      markerZoomAnimation={false}
      wheelPxPerZoomLevel={96}
    >
      <Ready />
      {onViewChange ? <BoundsReporter onChange={onViewChange} /> : null}
      <ZoomControl position="topright" />
      {mapboxToken ? <MapboxTiles token={mapboxToken} /> : null}
      <InteractionLock locked={mapLocked} />
      <ClickTrap enabled={mapClickEnabled && !mapLocked} onMapClick={onMapClick} />
      {plan ? <HoverTrap samples={plan.samples} onHoverKm={onHoverKm} /> : null}
      {fitPoints.length > 0 ? <Fit points={fitPoints} /> : null}

      {alternatives.map((alt) => {
        const positions = alt.geometry.map((p) => [p.lat, p.lon] as [number, number]);
        const select = (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          suppressMapClicks(600);
          onSelectRoute?.(alt.id);
        };
        return (
          <Fragment key={`alt-${alt.id}`}>
            <Polyline
              positions={positions}
              pathOptions={{ color: MAP_COLORS.alternative, weight: 5, opacity: 0.55, lineCap: "round", lineJoin: "round" }}
              interactive={false}
            />
            {/* Línea ancha e invisible: más fácil de tocar en el celular. */}
            <Polyline
              positions={positions}
              pathOptions={{ color: MAP_COLORS.alternative, weight: 18, opacity: 0.01 }}
              eventHandlers={{ click: select }}
            >
              <Tooltip sticky>
                {alt.label} · {formatKm(alt.distanceKm)} · {formatMinutes(alt.totalMinutes)} — toca para elegirla
              </Tooltip>
            </Polyline>
          </Fragment>
        );
      })}

      {segs.map((seg, i) => (
        <Polyline
          key={`seg-${i}`}
          positions={seg.positions}
          pathOptions={{ color: seg.color, weight: 5, opacity: 0.92, lineCap: "round", lineJoin: "round" }}
        />
      ))}

      {origin ? (
        <Marker position={[origin.lat, origin.lon]} icon={ICONS.origin}>
          <Popup>{origin.label}</Popup>
        </Marker>
      ) : null}
      {destination ? (
        <Marker position={[destination.lat, destination.lon]} icon={ICONS.dest}>
          <Popup>{destination.label}</Popup>
        </Marker>
      ) : null}

      {plan?.stops.map((st, i) => (
        <Marker
          key={`stop-${st.charger.id}`}
          position={[st.charger.lat, st.charger.lon]}
          icon={stopIcon(i + 1)}
          zIndexOffset={600}
        >
          <Popup>
            <div className="min-w-44 text-sm">
              <div className="font-medium text-fg">
                Parada {i + 1} — {st.charger.name}
              </div>
              <div className="mt-1 text-xs text-accent">
                Cargar {formatPct(st.arriveSoc)} → {formatPct(st.departSoc)}
              </div>
              <div className="text-xs text-muted">
                {formatKwh(st.energyAddedKwh)} · {formatMinutes(st.chargeMinutes)} · {formatKw(st.chargeKw)}
              </div>
              {st.fromRouteKm > 0.15 ? (
                <div className="text-xs text-muted">
                  {formatKm(st.fromRouteKm, 1)} de la ruta · desvío {formatKm(st.detourKm, 1)}
                  {st.detourMinutes >= 1 ? ` · +${formatMinutes(st.detourMinutes)}` : ""}
                </div>
              ) : (
                <div className="text-xs text-muted">Sobre la ruta</div>
              )}
              {st.kmToNext > 0 ? (
                <div className="text-xs text-muted">
                  Siguiente: {st.nextLabel} · {formatKm(st.kmToNext)}
                </div>
              ) : null}
              <div className="mt-2">
                <ChargerPopup charger={st.charger} action={chargerAction} />
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {extras.length ? <ChargerDots chargers={extras} action={chargerAction} /> : null}

      {hover ? (
        <CircleMarker
          center={[hover.lat, hover.lon]}
          radius={8}
          pathOptions={{ color: socColor(hover.soc), fillColor: socColor(hover.soc), fillOpacity: 1, weight: 2 }}
        />
      ) : null}
    </MapContainer>
  );
}
