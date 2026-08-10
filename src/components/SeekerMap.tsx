"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { boxBoundsAround } from "@/lib/c2c";

export type SeekerPoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  url: string;
};

// The Alps — a sensible "you are somewhere in climbing country" opening view.
const DEFAULT_VIEW: [number, number] = [45.5, 6.5];
const DEFAULT_ZOOM = 6;

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
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const areaRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const markerById = useRef(new Map<number, import("leaflet").CircleMarker>());
  const [ready, setReady] = useState(false);

  // Callbacks live in refs so the map is built exactly once — rebinding
  // handlers must never tear down the tiles the user is looking at.
  const handlers = useRef({ onPick, onSelect });
  useEffect(() => {
    handlers.current = { onPick, onSelect };
  }, [onPick, onSelect]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      // Leaflet touches `window` at import time, so it loads after mount only.
      const L = (await import("leaflet")).default;
      if (disposed || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current).setView(DEFAULT_VIEW, DEFAULT_ZOOM);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        handlers.current.onPick(e.latlng.lat, e.latlng.lng);
      });

      leafletRef.current = L;
      mapRef.current = map;
      areaRef.current = L.layerGroup().addTo(map);
      markersRef.current = L.layerGroup().addTo(map);
      setReady(true);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  // The search area: pin plus the circle the radius selector describes.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = areaRef.current;
    if (!ready || !L || !map || !layer) return;

    layer.clearLayers();
    if (!centre) return;

    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#bc5b2e";

    const box = boxBoundsAround(centre.lat, centre.lon, radiusKm);
    L.rectangle(
      [
        [box.south, box.west],
        [box.north, box.east],
      ],
      {
        color: accent,
        weight: 1,
        dashArray: "4 4",
        fillColor: accent,
        fillOpacity: 0.05,
        interactive: false,
      }
    ).addTo(layer);
    L.circleMarker([centre.lat, centre.lon], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: accent,
      fillOpacity: 1,
      interactive: false,
    }).addTo(layer);

    map.fitBounds(
      [
        [box.south, box.west],
        [box.north, box.east],
      ],
      { animate: false, padding: [20, 20] }
    );
  }, [centre, radiusKm, ready]);

  useEffect(() => {
    const L = leafletRef.current;
    const layer = markersRef.current;
    if (!ready || !L || !layer) return;

    layer.clearLayers();
    markerById.current.clear();

    for (const point of points) {
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#4a7fa5",
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
      markerById.current.set(point.id, marker);
    }
  }, [points, ready]);

  // Selecting a result — from either side — makes its marker stand out.
  useEffect(() => {
    if (!ready) return;
    for (const [id, marker] of markerById.current) {
      const active = id === activeId;
      marker.setStyle({ fillColor: active ? "#d94f2b" : "#4a7fa5", weight: active ? 3 : 1.5 });
      marker.setRadius(active ? 9 : 6);
      if (active) marker.bringToFront();
    }
  }, [activeId, points, ready]);

  return (
    <div className="seeker-map-wrap">
      <div ref={containerRef} className="seeker-map" />
      <p className="seeker-map-hint">{hint}</p>
    </div>
  );
}
