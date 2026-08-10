"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type SeekerPoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  url: string;
};

type Leaflet = typeof import("leaflet");

// The Alps — a sensible "you are somewhere in climbing country" opening view.
const DEFAULT_VIEW: [number, number] = [45.5, 6.5];
const DEFAULT_ZOOM = 6;

const MARKER_COLOR = "#4a7fa5";
const ACTIVE_COLOR = "#d94f2b";

export default function SeekerMap({
  centre,
  radiusKm,
  points,
  activeId,
  onPick,
  onSelect,
  hint,
}: {
  centre: { lat: number; lon: number } | null;
  radiusKm: number;
  points: SeekerPoint[];
  activeId: number | null;
  onPick: (lat: number, lon: number) => void;
  onSelect: (id: number) => void;
  hint: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The map lives in state, not a ref: every drawing effect below depends on
  // this exact instance, so if React tears the component down and builds a
  // second map, the layers are redrawn onto it and not onto the discarded one.
  const [map, setMap] = useState<import("leaflet").Map | null>(null);
  const [L, setL] = useState<Leaflet | null>(null);
  const markerById = useRef(new Map<number, import("leaflet").CircleMarker>());

  // Callbacks live in a ref so the map is built exactly once — rebinding
  // handlers must never tear down the tiles the user is looking at.
  const handlers = useRef({ onPick, onSelect });
  useEffect(() => {
    handlers.current = { onPick, onSelect };
  }, [onPick, onSelect]);

  useEffect(() => {
    let disposed = false;
    let created: import("leaflet").Map | undefined;

    (async () => {
      // Leaflet touches `window` at import time, so it loads after mount only.
      const mod = (await import("leaflet")).default;
      if (disposed || !containerRef.current) return;

      created = mod.map(containerRef.current).setView(DEFAULT_VIEW, DEFAULT_ZOOM);
      mod
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 17,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(created);
      created.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        handlers.current.onPick(e.latlng.lat, e.latlng.lng);
      });

      setL(() => mod);
      setMap(created);
    })();

    return () => {
      disposed = true;
      created?.remove();
      setMap(null);
    };
  }, []);

  // The search area: the circle the radius describes, plus the pin at its centre.
  useEffect(() => {
    if (!map || !L || !centre) return;

    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#bc5b2e";

    const circle = L.circle([centre.lat, centre.lon], {
      radius: radiusKm * 1000,
      color: accent,
      weight: 1,
      dashArray: "4 4",
      fillColor: accent,
      fillOpacity: 0.05,
      interactive: false,
    });
    const pin = L.circleMarker([centre.lat, centre.lon], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: accent,
      fillOpacity: 1,
      interactive: false,
    });
    const layer = L.layerGroup([circle, pin]).addTo(map);

    // The container is often still being laid out on the first pass, and
    // Leaflet would otherwise fit the circle to a stale, narrower width.
    map.invalidateSize();
    map.fitBounds(circle.getBounds(), { animate: false, padding: [20, 20] });

    return () => {
      layer.remove();
    };
  }, [map, L, centre, radiusKm]);

  useEffect(() => {
    if (!map || !L) return;

    const layer = L.layerGroup().addTo(map);
    const byId = new Map<number, import("leaflet").CircleMarker>();

    for (const point of points) {
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: MARKER_COLOR,
        fillOpacity: 0.9,
      })
        .bindTooltip(point.title)
        .on("click", (e) => {
          // Leaflet bubbles layer clicks up to the map: without this, picking a
          // route would also drop a new pin and restart the search.
          L.DomEvent.stopPropagation(e);
          handlers.current.onSelect(point.id);
        })
        .addTo(layer);
      byId.set(point.id, marker);
    }
    markerById.current = byId;

    return () => {
      layer.remove();
    };
  }, [map, L, points]);

  // Selecting a result — from either side — makes its marker stand out.
  useEffect(() => {
    for (const [id, marker] of markerById.current) {
      const active = id === activeId;
      marker.setStyle({ fillColor: active ? ACTIVE_COLOR : MARKER_COLOR, weight: active ? 3 : 1.5 });
      marker.setRadius(active ? 9 : 6);
      if (active) marker.bringToFront();
    }
  }, [activeId, points, map]);

  return (
    <div className="seeker-map-wrap">
      <div ref={containerRef} className="seeker-map" />
      <p className="seeker-map-hint">{hint}</p>
    </div>
  );
}
