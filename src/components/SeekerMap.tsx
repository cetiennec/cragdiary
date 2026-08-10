"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export type SeekerPoint = {
  id: number;
  title: string;
  lat: number;
  lon: number;
  url: string;
  /** Everything the list card shows as a chip: style, grade, rating, height… */
  tags: string[];
  area: string | null;
  /** Already localised ("12 km away" / "35 min by car"), or null with no centre. */
  distance: string | null;
  climbed: string | null;
  summary: string | null;
};

const TOOLTIP_SUMMARY_CHARS = 120;

// Built from DOM nodes rather than an HTML string: titles, areas and summaries
// come from camptocamp, and `textContent` can't be talked into being markup.
function tooltipCard(point: SeekerPoint): HTMLElement {
  const card = document.createElement("div");
  card.className = "seeker-tip";

  const title = document.createElement("strong");
  title.className = "seeker-tip-title";
  title.textContent = point.title;
  card.append(title);

  if (point.area) {
    const area = document.createElement("span");
    area.className = "seeker-tip-area";
    area.textContent = point.area;
    card.append(area);
  }

  if (point.tags.length) {
    const tags = document.createElement("span");
    tags.className = "seeker-tip-tags";
    for (const tag of point.tags) {
      const chip = document.createElement("span");
      chip.className = "seeker-tip-tag";
      chip.textContent = tag;
      tags.append(chip);
    }
    card.append(tags);
  }

  const meta = [point.distance, point.climbed].filter(Boolean).join(" · ");
  if (meta) {
    const line = document.createElement("span");
    line.className = "seeker-tip-meta";
    line.textContent = meta;
    card.append(line);
  }

  if (point.summary) {
    const summary = document.createElement("span");
    summary.className = "seeker-tip-summary";
    summary.textContent =
      point.summary.length > TOOLTIP_SUMMARY_CHARS
        ? `${point.summary.slice(0, TOOLTIP_SUMMARY_CHARS).trimEnd()}…`
        : point.summary;
    card.append(summary);
  }

  return card;
}

// The map clips its overflow, so a card opened near an edge would be cut off.
// Leaflet never repositions tooltips, so once one is open, flip it below the
// marker when there's no room above and slide it sideways to stay inside.
const TIP_GAP = 12;
const TIP_MARGIN = 8;

function keepTooltipInside(
  map: import("leaflet").Map,
  marker: import("leaflet").CircleMarker
): void {
  const tip = marker.getTooltip();
  const el = tip?.getElement();
  if (!tip || !el) return;

  // Above the marker unless the card is taller than the room left up there.
  const at = map.latLngToContainerPoint(marker.getLatLng());
  const above = at.y - el.offsetHeight - TIP_GAP >= TIP_MARGIN;
  const dy = above ? -TIP_GAP : TIP_GAP;

  tip.options.direction = above ? "top" : "bottom";
  tip.options.offset = [0, dy];
  tip.update();

  // Then correct whatever still hangs over an edge from where Leaflet actually
  // put it — measuring beats predicting, since the card's size depends on how
  // much the route has to say.
  const card = el.getBoundingClientRect();
  const frame = map.getContainer().getBoundingClientRect();
  const shift = (lo: number, hi: number, min: number, max: number) =>
    lo < min + TIP_MARGIN ? min + TIP_MARGIN - lo : hi > max - TIP_MARGIN ? max - TIP_MARGIN - hi : 0;
  const dx = shift(card.left, card.right, frame.left, frame.right);
  const fix = shift(card.top, card.bottom, frame.top, frame.bottom);

  if (dx || fix) {
    // The arrow is drawn under the middle of the card, so it only points at the
    // marker while the card is still centred on it.
    el.classList.toggle("nudged", dx !== 0);
    tip.options.offset = [dx, dy + fix];
    tip.update();
  } else {
    el.classList.remove("nudged");
  }
}

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
        .bindTooltip(tooltipCard(point), {
          direction: "top",
          offset: [0, -TIP_GAP],
          opacity: 1,
          className: "seeker-tip-wrap",
        })
        // Hovering a marker also lights up its card in the list below, so the
        // overview on the map and the full entry always agree. Leaflet has
        // opened the card by the time this runs, so it can be measured.
        .on("mouseover", () => {
          keepTooltipInside(map, marker);
          handlers.current.onSelect(point.id);
        })
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
