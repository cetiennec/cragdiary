"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { SeekerSource } from "@/lib/seeker/types";
import type { MountainHut } from "@/lib/seeker/refuges";
import type { ClimbingGym } from "@/lib/seeker/gyms";

export type SeekerPoint = {
  /** Unique across databases — "c2c:1234", "openbeta:<uuid>". */
  id: string;
  /** Which database it came from — what the marker is coloured by. */
  source: SeekerSource;
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
  /** "Camptocamp ↗" / "OpenBeta ↗" — the card carries a real link, so it
      must be a popup. */
  sourceLabel: string;
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

  const link = document.createElement("a");
  link.className = "seeker-tip-c2c";
  link.href = point.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = point.sourceLabel;
  card.append(link);

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

// Same rule as the result cards: built from DOM nodes, because the names and
// altitudes come from refuges.info and `textContent` cannot become markup.
function hutCard(
  hut: MountainHut,
  labels: { beds: string; noBeds: string; open: string }
): HTMLElement {
  const card = document.createElement("div");
  card.className = "seeker-tip";

  const title = document.createElement("strong");
  title.className = "seeker-tip-title";
  title.textContent = hut.name;
  card.append(title);

  const facts = [
    hut.altitude_m != null ? `${hut.altitude_m} m` : null,
    // Zero is an answer — an unguarded cabin with nowhere to sleep is worth
    // knowing before walking to it.
    hut.beds != null ? (hut.beds > 0 ? `${hut.beds} ${labels.beds}` : labels.noBeds) : null,
  ].filter(Boolean);
  if (facts.length) {
    const meta = document.createElement("span");
    meta.className = "seeker-tip-meta";
    meta.textContent = facts.join(" · ");
    card.append(meta);
  }

  const link = document.createElement("a");
  link.className = "seeker-tip-c2c";
  link.href = hut.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = labels.open;
  card.append(link);

  return card;
}

/** How to label a gym, shared by its map popup and its card in the list. */
export type GymLabels = { bouldering: string; visit: string };

// Same rule as hutCard: built from DOM nodes, since a gym's name comes from
// OpenStreetMap and `textContent` cannot become markup.
function gymCard(gym: ClimbingGym, labels: GymLabels): HTMLElement {
  const card = document.createElement("div");
  card.className = "seeker-tip";

  const title = document.createElement("strong");
  title.className = "seeker-tip-title";
  title.textContent = gym.name;
  card.append(title);

  if (gym.address) {
    const area = document.createElement("span");
    area.className = "seeker-tip-area";
    area.textContent = gym.address;
    card.append(area);
  }

  if (gym.bouldering) {
    const tags = document.createElement("span");
    tags.className = "seeker-tip-tags";
    const chip = document.createElement("span");
    chip.className = "seeker-tip-tag";
    chip.textContent = labels.bouldering;
    tags.append(chip);
    card.append(tags);
  }

  if (gym.phone) {
    const meta = document.createElement("span");
    meta.className = "seeker-tip-meta";
    meta.textContent = gym.phone;
    card.append(meta);
  }

  if (gym.website) {
    const link = document.createElement("a");
    link.className = "seeker-tip-c2c";
    link.href = gym.website;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = labels.visit;
    card.append(link);
  }

  return card;
}

/** One line of the map menu: a colour, what it means, and its switch. */
export type MapLayer = {
  id: string;
  label: string;
  color: string;
  /** Shelters are square; results are round. */
  square?: boolean;
  checked: boolean;
  /** A database that cannot answer the current activity stays listed, greyed. */
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
};

type Leaflet = typeof import("leaflet");

// The Alps — a sensible "you are somewhere in climbing country" opening view.
const DEFAULT_VIEW: [number, number] = [45.5, 6.5];
const DEFAULT_ZOOM = 6;

// One colour per database, so a glance at the map says where a marker's
// information comes from. The legend under the map is the key to these, and
// both are drawn from this one object so they can never disagree.
export const SOURCE_COLORS: Record<SeekerSource, string> = {
  c2c: "#4a7fa5",
  openbeta: "#2f8f6f",
};

// Shelters are not results and must not read as one: their own colour, and a
// square instead of a circle, so the difference survives a colour-blind eye and
// a black-and-white print alike.
export const HUT_COLOR = "#7d5ba6";

// Gyms are the same shape as shelters (a square, not a result) but need their
// own colour: both layers can be switched on together.
export const GYM_COLOR = "#c2793a";

// How far the pointer may travel between press and release and still count as
// a click rather than the end of a pan. A few pixels of hand tremor, no more.
const DRAG_SLOP = 6;

// Anything landing this close to a drawn marker is read as aiming at it. Wider
// than the 6 px markers themselves, because missing one by three pixels and
// having the whole search jump elsewhere is the annoyance being fixed.
const MARKER_SLOP = 20;

// How long the map has to be held before the search moves there. Long enough
// that no pan, zoom or moment of reading the map reaches it, short enough to
// hold without wondering whether anything is happening.
const LONG_PRESS_MS = 3000;

/**
 * The nearest marker to a click, within `MARKER_SLOP` pixels — results,
 * shelters and gyms alike, since a near-miss on any of them means the click was
 * aimed at a marker. `id` is set for results only: they are the ones the list
 * below can select.
 */
function nearestMarker(
  map: import("leaflet").Map,
  at: import("leaflet").Point,
  drawn: { points: SeekerPoint[]; huts: MountainHut[]; gyms: ClimbingGym[] }
): { id: string | null } | null {
  let best: { id: string | null } | null = null;
  let bestDistance = MARKER_SLOP;

  const consider = (lat: number, lon: number, id: string | null) => {
    const distance = map.latLngToContainerPoint([lat, lon]).distanceTo(at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { id };
    }
  };

  for (const point of drawn.points) consider(point.lat, point.lon, point.id);
  for (const hut of drawn.huts) consider(hut.lat, hut.lon, null);
  for (const gym of drawn.gyms) consider(gym.lat, gym.lon, null);

  return best;
}

// Selection is shown by size and a dark rim rather than a colour of its own:
// the fill has a meaning now, and a hovered marker must not look like it comes
// from a different database.
const ACTIVE_RING = "#3d2b1f";

export default function SeekerMap({
  centre,
  radiusKm,
  points,
  activeId,
  onPick,
  onSelect,
  hint,
  layers,
  layersLabel,
  huts,
  hutLabels,
  gyms,
  gymLabels,
}: {
  centre: { lat: number; lon: number } | null;
  radiusKm: number;
  points: SeekerPoint[];
  activeId: string | null;
  onPick: (lat: number, lon: number) => void;
  onSelect: (id: string) => void;
  hint: string;
  /**
   * The map's own menu: what each colour means and, since the answer is always
   * "a layer you can switch", the switch itself. Order is the drawing order.
   */
  layers: MapLayer[];
  /** Title above the menu. */
  layersLabel: string;
  /** Shelters to draw beside the results, empty when the layer is off. */
  huts: MountainHut[];
  /** How to label a shelter's popup. */
  hutLabels: { beds: string; noBeds: string; open: string };
  /** Indoor climbing gyms to draw beside the results, empty when the layer is off. */
  gyms: ClimbingGym[];
  /** How to label a gym's popup. */
  gymLabels: GymLabels;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The map lives in state, not a ref: every drawing effect below depends on
  // this exact instance, so if React tears the component down and builds a
  // second map, the layers are redrawn onto it and not onto the discarded one.
  const [map, setMap] = useState<import("leaflet").Map | null>(null);
  const [L, setL] = useState<Leaflet | null>(null);
  const markerById = useRef(new Map<string, import("leaflet").CircleMarker>());
  // Closing is delayed by a moment so the pointer can travel from the marker to
  // the card without it vanishing on the way — the card holds a link.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Everything currently drawn, read by the click guard below. A ref, not the
  // props themselves: the map is built once and its handler must always see the
  // current markers without rebinding.
  const drawn = useRef({ points, huts, gyms });
  useEffect(() => {
    drawn.current = { points, huts, gyms };
  }, [points, huts, gyms]);

  // Callbacks live in a ref so the map is built exactly once — rebinding
  // handlers must never tear down the tiles the user is looking at.
  const handlers = useRef({ onPick, onSelect });
  useEffect(() => {
    handlers.current = { onPick, onSelect };
  }, [onPick, onSelect]);

  useEffect(() => {
    let disposed = false;
    let created: import("leaflet").Map | undefined;
    let cleanupClick: (() => void) | undefined;

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
      // Moving the pin restarts the search, so no ordinary click does it: it
      // takes a deliberate press held for three seconds. A pan, a double-click
      // zoom and a marker missed by a few pixels are all ordinary clicks, and
      // none of them can move the search any more.
      const container = containerRef.current;
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      let pressedAt: { x: number; y: number } | null = null;
      let ring: HTMLElement | null = null;

      const endPress = () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
        pressedAt = null;
        ring?.remove();
        ring = null;
      };

      const onPointerDown = (e: PointerEvent) => {
        // Only the map itself: a press that starts on a marker, a popup or the
        // layer menu belongs to that thing, not to the map underneath.
        if (e.button !== 0 && e.pointerType === "mouse") return;
        const target = e.target as HTMLElement;
        if (target.closest(".leaflet-marker-icon, .leaflet-popup, .leaflet-control, .seeker-map-menu")) {
          return;
        }
        endPress();
        const box = container.getBoundingClientRect();
        pressedAt = { x: e.clientX, y: e.clientY };

        // Three seconds is long enough to wonder, so the press draws itself as
        // it fills.
        ring = document.createElement("span");
        ring.className = "seeker-press";
        ring.style.left = `${e.clientX - box.left}px`;
        ring.style.top = `${e.clientY - box.top}px`;
        container.append(ring);

        const point = new mod.Point(e.clientX - box.left, e.clientY - box.top);
        pressTimer = setTimeout(() => {
          const { lat, lng } = created!.containerPointToLatLng(point);
          endPress();
          handlers.current.onPick(lat, lng);
        }, LONG_PRESS_MS);
      };

      // Any travel means the hand was panning, not pointing.
      const onPointerMove = (e: PointerEvent) => {
        if (!pressedAt) return;
        if (Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > DRAG_SLOP) endPress();
      };

      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", endPress);
      container.addEventListener("pointercancel", endPress);
      container.addEventListener("pointerleave", endPress);
      // Touch devices raise the context menu around half a second in, which
      // would both cancel the press and cover the map with a menu.
      const onContextMenu = (e: Event) => {
        if (pressedAt) e.preventDefault();
      };
      container.addEventListener("contextmenu", onContextMenu);

      // A plain click still says "that marker there", so a near-miss selects it
      // rather than doing nothing at all.
      created.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        const near = nearestMarker(created!, e.containerPoint, drawn.current);
        if (near?.id) handlers.current.onSelect(near.id);
      });

      cleanupClick = () => {
        endPress();
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerup", endPress);
        container.removeEventListener("pointercancel", endPress);
        container.removeEventListener("pointerleave", endPress);
        container.removeEventListener("contextmenu", onContextMenu);
      };

      setL(() => mod);
      setMap(created);
    })();

    return () => {
      disposed = true;
      cleanupClick?.();
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
    // Draggable, so nudging the search a valley over is a gesture rather than a
    // click that has to land on empty map. The circle follows in real time,
    // since it is what the drag is actually aiming at.
    const pin = L.marker([centre.lat, centre.lon], {
      icon: L.divIcon({
        className: "seeker-centre-pin",
        html: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
      draggable: true,
      keyboard: false,
      zIndexOffset: 500,
    })
      .on("drag", (e) => {
        circle.setLatLng((e.target as import("leaflet").Marker).getLatLng());
      })
      .on("dragend", (e) => {
        const { lat, lng } = (e.target as import("leaflet").Marker).getLatLng();
        handlers.current.onPick(lat, lng);
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
    const byId = new Map<string, import("leaflet").CircleMarker>();

    for (const point of points) {
      const marker = L.circleMarker([point.lat, point.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: SOURCE_COLORS[point.source],
        fillOpacity: 0.9,
      })
        // A popup rather than a tooltip: the card holds a link to camptocamp,
        // and a tooltip can't be clicked — it isn't even reachable, since it
        // closes as soon as the pointer leaves the marker. Leaflet also nudges
        // a popup back into view near an edge, which a tooltip never did.
        .bindPopup(tooltipCard(point), {
          className: "seeker-tip-wrap",
          closeButton: false,
          autoPan: true,
          autoPanPadding: [12, 12],
          maxWidth: 260,
          offset: [0, -6],
        })
        // Hovering opens it and lights up its card in the list below, so the
        // overview on the map and the full entry always agree. It stays open
        // until another marker is hovered, so the link can be reached.
        .on("mouseover", () => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          marker.openPopup();
          handlers.current.onSelect(point.id);
        })
        .on("mouseout", () => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          closeTimer.current = setTimeout(() => marker.closePopup(), 260);
        })
        // Over the card itself, it stays; leaving it closes at once.
        .on("popupopen", (e) => {
          const el = e.popup.getElement();
          if (!el) return;
          el.onmouseenter = () => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
          };
          el.onmouseleave = () => marker.closePopup();
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
      if (closeTimer.current) clearTimeout(closeTimer.current);
      layer.remove();
    };
  }, [map, L, points]);

  // Shelters, on their own layer so switching them off never disturbs the
  // results underneath.
  useEffect(() => {
    if (!map || !L || huts.length === 0) return;

    const layer = L.layerGroup().addTo(map);
    for (const hut of huts) {
      L.marker([hut.lat, hut.lon], {
        icon: L.divIcon({
          className: "seeker-hut-pin",
          html: "",
          iconSize: [11, 11],
          iconAnchor: [5, 5],
        }),
        // Results come first: a shelter must never sit over a route marker.
        zIndexOffset: -500,
        keyboard: false,
      })
        .bindPopup(hutCard(hut, hutLabels), {
          className: "seeker-tip-wrap",
          closeButton: false,
          maxWidth: 240,
          offset: [0, -4],
        })
        .addTo(layer);
    }

    return () => {
      layer.remove();
    };
  }, [map, L, huts, hutLabels]);

  // Gyms, on their own layer for the same reason shelters get one: switching
  // it off must never disturb the results, or the shelters, underneath.
  useEffect(() => {
    if (!map || !L || gyms.length === 0) return;

    const layer = L.layerGroup().addTo(map);
    for (const gym of gyms) {
      L.marker([gym.lat, gym.lon], {
        icon: L.divIcon({
          className: "seeker-gym-pin",
          html: "",
          iconSize: [11, 11],
          iconAnchor: [5, 5],
        }),
        // Results first, then shelters, then gyms — a gym must never sit over
        // either a route marker or a shelter's.
        zIndexOffset: -600,
        keyboard: false,
      })
        .bindPopup(gymCard(gym, gymLabels), {
          className: "seeker-tip-wrap",
          closeButton: false,
          maxWidth: 240,
          offset: [0, -4],
        })
        .addTo(layer);
    }

    return () => {
      layer.remove();
    };
  }, [map, L, gyms, gymLabels]);

  // Selecting a result — from either side — makes its marker stand out, while
  // keeping the fill that says which database it came from.
  useEffect(() => {
    const sourceById = new Map(points.map((p) => [p.id, p.source]));
    for (const [id, marker] of markerById.current) {
      const active = id === activeId;
      const source = sourceById.get(id);
      marker.setStyle({
        fillColor: source ? SOURCE_COLORS[source] : SOURCE_COLORS.c2c,
        color: active ? ACTIVE_RING : "#ffffff",
        weight: active ? 3 : 1.5,
      });
      marker.setRadius(active ? 9 : 6);
      if (active) marker.bringToFront();
    }
  }, [activeId, points, map]);

  return (
    <div className="seeker-map-wrap">
      <div ref={containerRef} className="seeker-map" />
      {/* Sits over the map rather than under it, the way a map's own key does.
          It is a plain overlay and not a Leaflet control: clicks land on it and
          never reach the map, so ticking a layer cannot also drop the pin. */}
      {layers.length > 0 && (
        <div className="seeker-map-menu">
          <p className="seeker-map-menu-head">{layersLabel}</p>
          <ul>
            {layers.map((layer) => (
              <li key={layer.id}>
                <label
                  className={layer.disabled ? "is-disabled" : undefined}
                  title={layer.title}
                >
                  <input
                    type="checkbox"
                    checked={layer.checked}
                    disabled={layer.disabled}
                    onChange={layer.onToggle}
                  />
                  <span
                    className={`seeker-legend-dot${layer.square ? " seeker-legend-square" : ""}`}
                    style={{ background: layer.color }}
                    aria-hidden
                  />
                  {layer.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="seeker-map-hint">{hint}</p>
    </div>
  );
}
