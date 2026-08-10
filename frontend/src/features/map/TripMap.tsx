import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Layer,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  type LayerProps,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { Truck } from "lucide-react";

import { RULE, formatClockTime, formatDuration, formatMiles } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { PlannedRoute, Stop, Waypoint } from "@/types/hos";

// OpenFreeMap serves OpenStreetMap vector tiles with no key and no rate limit. The
// attribution below is a condition of using it.
const STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

// The OpenFreeMap styles already declare the required "OpenFreeMap © OpenMapTiles Data
// from OpenStreetMap" credit on their tile source, and MapLibre renders it automatically.
// Passing it again as customAttribution prints the whole line twice.

// MapLibre paints with its own colour parser and cannot read the CSS custom properties
// the rest of the interface uses, so the route colours are mirrored here as literals.
// They must stay in step with the duty-status hues in index.css.
const ROUTE_GREEN = "#35c48a";
const ALTERNATIVE_GREY = "#8c93a3";

interface TripMapProps {
  routes: PlannedRoute[];
  selectedIndex: number;
  waypoints: Waypoint[];
  theme: "dark" | "light";
  onSelectRoute: (index: number) => void;
  /** Truck position along the selected route, from the scrubber. */
  vehiclePosition?: [number, number] | null;
}

function lineFeature(route: PlannedRoute) {
  return {
    type: "Feature" as const,
    properties: { index: route.index },
    geometry: { type: "LineString" as const, coordinates: route.geometry },
  };
}

/** Bounding box of every point the map needs to show, as MapLibre wants it. */
function boundsOf(coordinates: [number, number][]): [[number, number], [number, number]] | null {
  if (coordinates.length === 0) return null;
  let [west, south] = coordinates[0]!;
  let [east, north] = coordinates[0]!;
  for (const [longitude, latitude] of coordinates) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [
    [west, south],
    [east, north],
  ];
}

export function TripMap({
  routes,
  selectedIndex,
  waypoints,
  theme,
  onSelectRoute,
  vehiclePosition,
}: TripMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [openStop, setOpenStop] = useState<Stop | null>(null);
  const [hoveredRoute, setHoveredRoute] = useState<number | null>(null);

  const selected = routes[selectedIndex] ?? routes[0];
  const alternatives = useMemo(
    () => routes.filter((route) => route.index !== selected?.index),
    [routes, selected],
  );

  const selectedCollection = useMemo(
    () => (selected ? { type: "FeatureCollection" as const, features: [lineFeature(selected)] } : null),
    [selected],
  );
  const alternativeCollection = useMemo(
    () => ({ type: "FeatureCollection" as const, features: alternatives.map(lineFeature) }),
    [alternatives],
  );

  // Refit whenever the chosen route changes, so switching alternatives always frames the
  // whole trip rather than leaving the viewer somewhere in the middle of it.
  const fitToRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const bounds = boundsOf(selected.geometry);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, duration: 700 });
  }, [selected]);

  useEffect(() => {
    fitToRoute();
  }, [fitToRoute]);

  const stops = selected?.stops.filter((stop) => RULE[stop.ruleId].isStop) ?? [];

  return (
    <div className="relative size-full overflow-hidden rounded-lg border border-border">
      <Map
        ref={mapRef}
        mapStyle={STYLES[theme]}
        attributionControl={false}
        initialViewState={{ longitude: -98.5, latitude: 39.5, zoom: 3.2 }}
        interactiveLayerIds={alternatives.map((route) => `alternative-${route.index}-hit`)}
        onLoad={fitToRoute}
        onClick={(event) => {
          const feature = event.features?.[0];
          const index = feature?.properties?.index;
          if (typeof index === "number") onSelectRoute(index);
        }}
        onMouseMove={(event) => {
          const index = event.features?.[0]?.properties?.index;
          setHoveredRoute(typeof index === "number" ? index : null);
        }}
        cursor={hoveredRoute === null ? "grab" : "pointer"}
        style={{ width: "100%", height: "100%" }}
      >
        <AttributionControl compact position="bottom-right" />
        <NavigationControl position="top-right" showCompass={false} />
        <ScaleControl position="bottom-left" unit="imperial" />

        {/* Alternatives sit behind the chosen route, dimmed. A wide transparent hit line
            rides on top of each so they can be clicked without demanding pixel accuracy. */}
        <Source id="alternatives" type="geojson" data={alternativeCollection}>
          <Layer {...alternativeLine(hoveredRoute)} />
        </Source>
        {alternatives.map((route) => (
          <Source
            key={route.index}
            id={`alternative-${route.index}`}
            type="geojson"
            data={{ type: "FeatureCollection", features: [lineFeature(route)] }}
          >
            <Layer id={`alternative-${route.index}-hit`} type="line" paint={{ "line-width": 16, "line-opacity": 0 }} />
          </Source>
        ))}

        {selectedCollection && (
          <Source id="selected-route" type="geojson" data={selectedCollection}>
            <Layer {...routeCasing} />
            <Layer {...routeLine} />
          </Source>
        )}

        {waypoints.map((waypoint, index) => (
          <Marker key={`${waypoint.label}-${index}`} longitude={waypoint.longitude} latitude={waypoint.latitude} anchor="bottom">
            <WaypointPin index={index} label={waypoint.label} />
          </Marker>
        ))}

        {stops.map((stop) => (
          <Marker
            key={`${stop.ruleId}-${stop.startMinute}`}
            longitude={stop.position[0]}
            latitude={stop.position[1]}
            anchor="center"
            onClick={(event) => {
              event.originalEvent.stopPropagation();
              setOpenStop(stop);
            }}
          >
            <StopPin stop={stop} isOpen={openStop?.startMinute === stop.startMinute} />
          </Marker>
        ))}

        {vehiclePosition && (
          // Drawn above the stop pins and larger than them: this is the one marker that
          // moves, and it has to stay findable while the scrubber runs.
          <Marker longitude={vehiclePosition[0]} latitude={vehiclePosition[1]} anchor="center" style={{ zIndex: 10 }}>
            <span className="relative flex size-8 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-status-driving/30" aria-hidden />
              <span className="relative flex size-8 items-center justify-center rounded-full border-2 border-background bg-status-driving shadow-lg">
                <Truck className="size-4 text-background" aria-hidden />
              </span>
            </span>
          </Marker>
        )}

        {openStop && (
          <Popup
            longitude={openStop.position[0]}
            latitude={openStop.position[1]}
            anchor="bottom"
            offset={16}
            closeButton
            closeOnClick={false}
            onClose={() => setOpenStop(null)}
            maxWidth="260px"
          >
            <StopSummary stop={openStop} />
          </Popup>
        )}
      </Map>
    </div>
  );
}

const routeCasing = {
  id: "route-casing",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#000000", "line-opacity": 0.35, "line-width": 7 },
} satisfies LayerProps;

const routeLine = {
  id: "route-line",
  type: "line",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": ROUTE_GREEN, "line-width": 4 },
} satisfies LayerProps;

/** Dimmed alternatives, with the hovered one promoted toward the foreground. */
function alternativeLine(hoveredIndex: number | null): LayerProps {
  return {
    id: "alternative-lines",
    type: "line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ALTERNATIVE_GREY,
      "line-width": 3,
      "line-dasharray": [2, 1.5],
      "line-opacity": [
        "case",
        ["==", ["get", "index"], hoveredIndex ?? -1],
        0.95,
        0.45,
      ],
    },
  };
}

const WAYPOINT_LABELS = ["Start", "Pickup", "Dropoff"];

function WaypointPin({ index, label }: { index: number; label: string }) {
  return (
    <span className="flex flex-col items-center gap-1">
      <span className="rounded bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground shadow">
        {WAYPOINT_LABELS[index] ?? label}
      </span>
      <span className="size-3 rotate-45 border-2 border-background bg-primary shadow-md" />
    </span>
  );
}

function StopPin({ stop, isOpen }: { stop: Stop; isOpen: boolean }) {
  const Icon = RULE[stop.ruleId].icon;
  return (
    <button
      type="button"
      aria-label={
        stop.isNearDestination
          ? `${RULE[stop.ruleId].short} at ${stop.location}, only ${stop.minutesToDestination} minutes from the dropoff`
          : `${RULE[stop.ruleId].short} at ${stop.location}`
      }
      className={cn(
        "flex size-7 items-center justify-center rounded-full border-2 shadow-md transition-transform",
        "bg-card text-foreground hover:scale-110",
        // A mandatory rest within sight of the delivery is the one stop worth finding
        // on the map without hunting for it.
        stop.isNearDestination ? "border-signal-warn ring-2 ring-signal-warn/40" : "border-background",
        isOpen && "scale-110 ring-2 ring-ring",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

function StopSummary({ stop }: { stop: Stop }) {
  const Icon = RULE[stop.ruleId].icon;
  return (
    <div className="space-y-1.5 text-foreground">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-3.5" aria-hidden />
        {RULE[stop.ruleId].short}
      </p>
      <p className="text-xs text-muted-foreground">{stop.location}</p>
      <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Arrives</dt>
        <dd>{formatClockTime(stop.startMinute)}</dd>
        <dt className="text-muted-foreground">Stopped</dt>
        <dd>{formatDuration(stop.durationMinutes)}</dd>
        <dt className="text-muted-foreground">Mile</dt>
        <dd>{formatMiles(stop.milesFromOrigin)}</dd>
      </dl>

      {stop.isNearDestination && (
        <p className="rounded border border-signal-warn/40 bg-signal-warn/10 px-2 py-1.5 text-xs leading-relaxed text-signal-warn">
          Only {formatDuration(stop.minutesToDestination)} of driving left to the dropoff — but the clock has run
          out, and Part 395 has no exemption for finishing the last few miles.
        </p>
      )}
    </div>
  );
}
