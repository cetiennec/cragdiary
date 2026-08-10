"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  id: string;
  title: string;
  lat: number;
  lon: number;
  href?: string;
  /** Cover photo, shown as a thumbnail in the hover card. */
  photoId?: string;
  /** The camptocamp outing this day came from, if any. */
  c2cUrl?: string;
  date?: string;
};

const WISH_COLOR = "#4a7fa5";

// Built from DOM nodes rather than an HTML string: titles come from the
// journal, and `textContent` can't be talked into being markup.
function popupCard(point: MapPoint, openOnC2c: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "map-pop";

  const main = document.createElement("a");
  main.className = "map-pop-main";
  if (point.href) {
    main.href = point.href;
    if (point.href.startsWith("http")) {
      main.target = "_blank";
      main.rel = "noopener noreferrer";
    }
  }

  if (point.photoId) {
    const img = document.createElement("img");
    // The same thumbnail the cards on this page use, so it's already cached.
    img.src = `/api/photos/${point.photoId}?t=1`;
    img.alt = "";
    img.loading = "lazy";
    img.className = "map-pop-thumb";
    main.append(img);
  }

  const title = document.createElement("strong");
  title.className = "map-pop-title";
  title.textContent = point.title;
  main.append(title);

  if (point.date) {
    const date = document.createElement("span");
    date.className = "map-pop-date";
    date.textContent = point.date;
    main.append(date);
  }
  card.append(main);

  if (point.c2cUrl) {
    const link = document.createElement("a");
    link.className = "map-pop-c2c";
    link.href = point.c2cUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = openOnC2c;
    card.append(link);
  }

  return card;
}

export default function ProfileMap({
  points,
  wishPoints = [],
  wishLabel,
  wishTitle,
  openOnC2c,
}: {
  points: MapPoint[];
  wishPoints?: MapPoint[];
  wishLabel?: string;
  wishTitle?: string;
  openOnC2c: string;
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

        marker.bindPopup(popupCard(point, openOnC2c), {
          className: "map-pop-wrap",
          closeButton: false,
          // The map clips its overflow, so a card near an edge would be cut
          // off; letting Leaflet nudge the map keeps it whole. Harmless on
          // hover, since the card doesn't close when the pointer leaves.
          autoPan: true,
          autoPanPadding: [12, 12],
          maxWidth: 240,
          offset: [0, -4],
        });
        // Hovering is enough to see it; it stays put so its links can be
        // clicked, and hovering another pin swaps it out.
        marker.on("mouseover", () => marker.openPopup());

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
  }, [points, wishPoints, showWishes, openOnC2c]);

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
