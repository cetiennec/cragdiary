"use client";

import { useState } from "react";

export type PhotoLayoutValue = { align: string; size: string; para: string; caption: string };

export type PlacerPhoto = {
  key: string;
  src: string;
  para: number; // interstice it currently sits at (1..count+1)
  align: string; // gallery | left | right | full
  size: string; // s | m | l
};

export type PlacerLabels = {
  hint: string; // one-line explanation above the strip
  empty: string; // shown when there are no paragraphs yet
  noPhotos: string; // shown in the picker when nothing is left to place
  add: string; // aria-label for the "+" insertion button
  end: string; // label for the final interstice (after the last paragraph)
  remove: string; // aria-label for taking a photo back out of the text
  pick: string; // aria-label for a photo in the picker
  left: string; // "in text — left"
  right: string; // "in text — right"
  full: string; // "full width"
  size: string; // "size"
};

const ALIGNS: { value: string; glyph: string; key: "left" | "right" | "full" }[] = [
  { value: "left", glyph: "◧", key: "left" },
  { value: "right", glyph: "◨", key: "right" },
  { value: "full", glyph: "▬", key: "full" },
];

function snippet(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 70 ? `${clean.slice(0, 70)}…` : clean;
}

// A live outline of the notes broken into paragraphs, with a "+" at every gap
// (before the first paragraph, between each, and after the last). Tap a "+" to
// drop one of the day's photos into the text there. Each placed photo carries
// its own left / right / full and size controls so the whole "where and how it
// sits in the text" concept lives in one place.
export default function PhotoTextPlacer({
  paragraphs,
  photos,
  onPlace,
  onUnplace,
  onAdjust,
  t,
}: {
  paragraphs: string[];
  photos: PlacerPhoto[];
  onPlace: (key: string, para: number) => void;
  onUnplace: (key: string) => void;
  onAdjust: (key: string, patch: Partial<PhotoLayoutValue>) => void;
  t: PlacerLabels;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const count = paragraphs.length;

  if (count === 0) {
    return <p className="placer-empty">{t.empty}</p>;
  }

  const available = photos.filter((p) => p.align === "gallery");
  const atPoint = (n: number) =>
    photos.filter((p) => p.align !== "gallery" && p.para === n);

  function placed(p: PlacerPhoto) {
    return (
      <div className="placer-placed" key={p.key}>
        <span
          className="placer-thumb"
          style={{ backgroundImage: `url("${p.src}")` }}
        >
          <button
            type="button"
            className="placer-thumb-x"
            aria-label={t.remove}
            onClick={() => onUnplace(p.key)}
          >
            ×
          </button>
        </span>
        <span className="placer-controls">
          <span className="seg-group" role="group">
            {ALIGNS.map((a) => (
              <button
                key={a.value}
                type="button"
                className="seg-btn"
                data-active={p.align === a.value}
                title={t[a.key]}
                aria-label={t[a.key]}
                aria-pressed={p.align === a.value}
                onClick={() => onAdjust(p.key, { align: a.value })}
              >
                {a.glyph}
              </button>
            ))}
          </span>
          {(p.align === "left" || p.align === "right") && (
            <span className="seg-group" role="group" aria-label={t.size}>
              {["s", "m", "l"].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="seg-btn"
                  data-active={p.size === s}
                  aria-pressed={p.size === s}
                  onClick={() => onAdjust(p.key, { size: s })}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
    );
  }

  function point(n: number, endLabel?: string) {
    const here = atPoint(n);
    const open = openAt === n;
    return (
      <div className="placer-point">
        {here.length > 0 && <div className="placer-placed-row">{here.map(placed)}</div>}
        <div className="placer-point-row">
          <button
            type="button"
            className="placer-add"
            aria-label={t.add}
            aria-expanded={open}
            data-open={open}
            onClick={() => setOpenAt(open ? null : n)}
          >
            +
          </button>
          {endLabel && <span className="placer-end-label">{endLabel}</span>}
        </div>
        {open && (
          <div className="placer-picker" role="menu">
            {available.length === 0 ? (
              <span className="placer-nophotos">{t.noPhotos}</span>
            ) : (
              available.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="placer-pick"
                  aria-label={t.pick}
                  style={{ backgroundImage: `url("${p.src}")` }}
                  onClick={() => {
                    onPlace(p.key, n);
                    setOpenAt(null);
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="photo-placer">
      <p className="placer-hint">{t.hint}</p>
      {point(1)}
      {paragraphs.map((para, i) => (
        <div key={i} className="placer-block">
          <p className="placer-para">{snippet(para)}</p>
          {point(i + 2, i === count - 1 ? t.end : undefined)}
        </div>
      ))}
    </div>
  );
}
