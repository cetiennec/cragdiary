"use client";

// The pieces of the second Cragseeker menu that are drawings rather than
// state: the activity glyphs and the orientation compass.

import { C2C_ORIENTATIONS } from "@/lib/c2c";

// Line glyphs on a 24-unit grid, stroked in the text colour so they follow
// the theme and the pressed state without a second set.
const GLYPHS: Record<string, string> = {
  rock_climbing: "M3 21 9 8l4 6 3-4 5 11Z M9 8l1.5 5",
  mountain_climbing: "M2 20 9 7l3 5 3-3 7 11Z M7.5 10l1.5 1 1.5-1",
  snow_ice_mixed: "M3 20 10 8l3 4 2-2 6 10Z M17 3v5 M14.8 4.2l4.4 2.6 M19.2 4.2l-4.4 2.6",
  ice_climbing: "M12 2v20 M4 7l16 10 M20 7 4 17 M9 3l3 2 3-2 M9 21l3-2 3 2",
  via_ferrata: "M7 2v20 M17 2v20 M7 6h10 M7 11h10 M7 16h10",
  skitouring: "M3 18l18-6 M5 21l16-5 M15 3a2 2 0 1 1 0 4a2 2 0 1 1 0-4 M10 13l3-5 3 3",
  hiking: "M7 21c2-1 4-1 5-4l1-5 3 2 3 1 M13 2a2 2 0 1 1 0 4a2 2 0 1 1 0-4 M13 8l-3 3-2 5",
  indoor: "M3 21V9l9-6 9 6v12Z M9 21v-6h6v6 M9 10h.01 M14 12h.01 M11 7h.01",
};

export function ActivityGlyph({ id }: { id: string }) {
  return (
    <svg viewBox="0 0 24 24" className="seeker2-glyph" aria-hidden>
      <path d={GLYPHS[id] ?? GLYPHS.rock_climbing} />
    </svg>
  );
}

// Eight slices of a ring, north up, each a button for one aspect. The sun sits
// in the middle as a reminder of what the choice is really about.
export function Compass({
  facing,
  onToggle,
  label,
}: {
  facing: string[];
  onToggle: (o: string) => void;
  label: string;
}) {
  const R = 72;
  const r = 24;
  const at = (rad: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(rad * Math.cos(a)).toFixed(1)},${(rad * Math.sin(a)).toFixed(1)}`;
  };
  return (
    <svg viewBox="-80 -80 160 160" className="seeker2-compass" role="group" aria-label={label}>
      {C2C_ORIENTATIONS.map((o, i) => {
        const a0 = i * 45 - 22.5;
        const a1 = i * 45 + 22.5;
        const on = facing.includes(o);
        const mid = ((i * 45 - 90) * Math.PI) / 180;
        return (
          <g
            key={o}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={o}
            className={on ? "on" : undefined}
            onClick={() => onToggle(o)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle(o);
              }
            }}
          >
            <path
              d={`M${at(r, a0)} L${at(R, a0)} A${R},${R} 0 0 1 ${at(R, a1)} L${at(r, a1)} A${r},${r} 0 0 0 ${at(r, a0)}Z`}
            />
            <text x={(50 * Math.cos(mid)).toFixed(1)} y={(50 * Math.sin(mid)).toFixed(1)}>
              {o}
            </text>
          </g>
        );
      })}
      <circle className="seeker2-sun" r="8" />
    </svg>
  );
}
