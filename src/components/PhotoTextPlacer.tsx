"use client";

import { useState } from "react";

export type PlacerPhoto = {
  key: string;
  src: string;
  para: number; // interstice it currently sits at (1..count+1)
  inline: boolean; // true when placed in the text (align != gallery)
};

export type PlacerLabels = {
  hint: string; // one-line explanation above the strip
  empty: string; // shown when there are no paragraphs yet
  noPhotos: string; // shown in the picker when nothing is left to place
  add: string; // aria-label for the "+" insertion button
  end: string; // label for the final interstice (after the last paragraph)
  remove: string; // aria-label for taking a photo back out of the text
  pick: string; // aria-label for a photo in the picker
};

function snippet(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 70 ? `${clean.slice(0, 70)}…` : clean;
}

// A live preview of the notes broken into paragraphs, with a "+" at every gap
// (before the first paragraph, between each, and after the last). Click a "+"
// to drop one of the day's photos into the text at exactly that spot. Photos
// already placed show as thumbnails at their gap, each removable back to the
// gallery.
export default function PhotoTextPlacer({
  paragraphs,
  photos,
  onPlace,
  onUnplace,
  t,
}: {
  paragraphs: string[];
  photos: PlacerPhoto[];
  onPlace: (key: string, para: number) => void;
  onUnplace: (key: string) => void;
  t: PlacerLabels;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const count = paragraphs.length;

  if (count === 0) {
    return <p className="placer-empty">{t.empty}</p>;
  }

  const available = photos.filter((p) => !p.inline);
  const atPoint = (n: number) =>
    photos.filter((p) => p.inline && p.para === n);

  function point(n: number, endLabel?: string) {
    const placed = atPoint(n);
    const open = openAt === n;
    return (
      <div className="placer-point">
        <div className="placer-point-row">
          {placed.map((p) => (
            <span
              key={p.key}
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
          ))}
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
