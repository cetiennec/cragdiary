"use client";

export type PhotoLayoutValue = { align: string; size: string; para: string; caption: string };

export type PlacementLabels = {
  gallery: string;
  left: string;
  right: string;
  full: string;
  size: string;
};

const PLACEMENTS: { value: string; glyph: string; key: keyof PlacementLabels }[] = [
  { value: "gallery", glyph: "▦", key: "gallery" },
  { value: "left", glyph: "◧", key: "left" },
  { value: "right", glyph: "◨", key: "right" },
  { value: "full", glyph: "▬", key: "full" },
];

export default function PhotoPlacement({
  value,
  onChange,
  names,
  t,
}: {
  value: PhotoLayoutValue;
  onChange: (patch: Partial<PhotoLayoutValue>) => void;
  names: { align: string; size: string; para: string };
  t: PlacementLabels;
}) {
  return (
    <span className="photo-layout-controls">
      <input type="hidden" name={names.align} value={value.align} />
      <input type="hidden" name={names.size} value={value.size} />
      <input type="hidden" name={names.para} value={value.para} />

      <span className="seg-group" role="group">
        {PLACEMENTS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="seg-btn"
            data-active={value.align === p.value}
            title={t[p.key]}
            aria-label={t[p.key]}
            aria-pressed={value.align === p.value}
            onClick={() => onChange({ align: p.value })}
          >
            {p.glyph}
          </button>
        ))}
      </span>

      {(value.align === "left" || value.align === "right") && (
        <span className="seg-group" role="group" aria-label={t.size}>
          {["s", "m", "l"].map((size) => (
            <button
              key={size}
              type="button"
              className="seg-btn"
              data-active={value.size === size}
              aria-pressed={value.size === size}
              onClick={() => onChange({ size })}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
