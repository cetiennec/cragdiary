"use client";

export type PhotoLayoutValue = { align: string; size: string; para: string; caption: string };

export type PlacementLabels = {
  gallery: string;
  left: string;
  right: string;
  full: string;
  size: string;
  para: string;
  anchorHint: string;
  anchorEnd: string;
  anchorEmpty: string;
};

const PLACEMENTS: { value: string; glyph: string; key: keyof PlacementLabels }[] = [
  { value: "gallery", glyph: "▦", key: "gallery" },
  { value: "left", glyph: "◧", key: "left" },
  { value: "right", glyph: "◨", key: "right" },
  { value: "full", glyph: "▬", key: "full" },
];

function snippet(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

export default function PhotoPlacement({
  value,
  onChange,
  names,
  t,
  paragraphs,
  photoKey,
}: {
  value: PhotoLayoutValue;
  onChange: (patch: Partial<PhotoLayoutValue>) => void;
  names: { align: string; size: string; para: string };
  t: PlacementLabels;
  paragraphs: string[];
  photoKey: string;
}) {
  const anchored = value.align !== "gallery";
  const count = paragraphs.length;
  const current = Number(value.para) || 1;
  // Values run 1..count for "before paragraph i"; count+1 anchors after the last
  // one (end of notes). Clamp so a stale value past the end lights the End chip.
  const endValue = count + 1;
  const isEnd = current > count;

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

      {anchored && (
        <span className="photo-anchor" role="group" aria-label={t.para}>
          <span className="photo-anchor-hint">{t.anchorHint}</span>
          <span className="photo-anchor-chips" data-anchor-owner={photoKey}>
            {count === 0 ? (
              <span className="anchor-empty">{t.anchorEmpty}</span>
            ) : (
              paragraphs.map((para, i) => {
                const chipValue = i + 1;
                const active = !isEnd && current === chipValue;
                return (
                  <button
                    key={i}
                    type="button"
                    className="anchor-chip"
                    data-anchor-chip
                    data-anchor-owner={photoKey}
                    data-anchor-value={chipValue}
                    data-active={active}
                    aria-pressed={active}
                    title={snippet(para) || `¶${chipValue}`}
                    onClick={() => onChange({ para: String(chipValue) })}
                  >
                    <span className="anchor-chip-num">¶{chipValue}</span>
                    <span className="anchor-chip-text">{snippet(para)}</span>
                  </button>
                );
              })
            )}
            {count > 0 && (
              <button
                type="button"
                className="anchor-chip anchor-chip-end"
                data-anchor-chip
                data-anchor-owner={photoKey}
                data-anchor-value={endValue}
                data-active={isEnd}
                aria-pressed={isEnd}
                title={t.anchorEnd}
                onClick={() => onChange({ para: String(endValue) })}
              >
                {t.anchorEnd}
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
