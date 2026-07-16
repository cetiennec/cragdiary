"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  title: string;
  lat: number;
  lon: number;
};

export default function ProfileMap({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let disposed = false;
    let map: import("leaflet").Map | undefined;

    (async () => {
      // Leaflet touches `window` at import time, so it must be loaded
      // client-side only, after mount.
      const L = (await import("leaflet")).default;
      if (disposed || !containerRef.current) return;

      map = L.map(containerRef.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const accent =
        getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() ||
        "#bc5b2e";

      const bounds = L.latLngBounds([]);
      for (const point of points) {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: accent,
          fillOpacity: 0.9,
        }).addTo(map);

        const link = document.createElement("a");
        link.href = `/entries/${point.id}`;
        link.textContent = point.title;
        marker.bindPopup(link);

        bounds.extend([point.lat, point.lon]);
      }

      map.fitBounds(bounds.pad(0.25), { maxZoom: 11 });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [points]);

  if (points.length === 0) return null;

  return <div ref={containerRef} className="profile-map" />;
}
