"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  href?: string;
};

const WISH_COLOR = "#4a7fa5";

export default function ProfileMap({
  points,
  wishPoints = [],
  wishLabel,
  wishTitle,
}: {
  points: MapPoint[];
  wishPoints?: MapPoint[];
  wishLabel?: string;
  wishTitle?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showWishes, setShowWishes] = useState(false);

  useEffect(() => {
    const visible = showWishes ? [...points, ...wishPoints] : points;
    if (!containerRef.current || visible.length === 0) return;

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
      const draw = (point: MapPoint, wish: boolean) => {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: wish ? WISH_COLOR : accent,
          fillOpacity: wish ? 0.65 : 0.9,
          dashArray: wish ? "2 3" : undefined,
        }).addTo(map!);

        if (point.href) {
          const link = document.createElement("a");
          link.href = point.href;
          if (point.href.startsWith("http")) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
          link.textContent = point.title;
          marker.bindPopup(link);
        } else {
          marker.bindPopup(point.title);
        }

        bounds.extend([point.lat, point.lon]);
      };

      for (const point of points) draw(point, false);
      if (showWishes) for (const point of wishPoints) draw(point, true);

      map.fitBounds(bounds.pad(0.25), { maxZoom: 11 });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [points, wishPoints, showWishes]);

  const nothingToShow = points.length === 0 && (!showWishes || wishPoints.length === 0);
  if (points.length === 0 && wishPoints.length === 0) return null;

  return (
    <div className="profile-map-wrap">
      {!nothingToShow && <div ref={containerRef} className="profile-map" />}
      {wishPoints.length > 0 && wishLabel && (
        <label className={`map-wish-toggle${nothingToShow ? "" : " on-map"}`} title={wishTitle}>
          <input
            type="checkbox"
            checked={showWishes}
            onChange={(e) => setShowWishes(e.target.checked)}
          />
          <span className="map-wish-switch" aria-hidden />
          {wishLabel}
        </label>
      )}
    </div>
  );
}
