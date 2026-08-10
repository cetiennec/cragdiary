// A rough driving-time estimate, computed locally — no routing service, so
// nothing about where the user lives ever leaves the browser. It is a guide for
// comparing crags ("an hour" vs "half a day"), not a satnav ETA.

import { distanceKm } from "@/lib/c2c";

// Roads wander: real driving distance runs ~30% longer than the crow flies,
// and more so in the mountains where valleys dictate the route.
const DETOUR_FACTOR = 1.3;

// Average door-to-door speed by trip length. Short hops stay on small roads;
// long ones spend most of their time on motorways. The last kilometres to a
// crag are always slow, which is why even the fastest tier stays under 100.
const SPEED_KMH: [maxKm: number, kmh: number][] = [
  [25, 40],
  [75, 60],
  [200, 75],
  [Infinity, 85],
];

export function drivingMinutes(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const road = distanceKm(from, to) * DETOUR_FACTOR;
  const speed = SPEED_KMH.find(([maxKm]) => road <= maxKm)![1];
  return Math.round((road / speed) * 60);
}

// "45 min" / "2 h 05" — the same shape in both languages.
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(5, Math.round(minutes / 5) * 5)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 5) * 5;
  if (rest === 60) return `${hours + 1} h`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}
