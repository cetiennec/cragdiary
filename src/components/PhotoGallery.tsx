"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryPhoto = {
  id: string;
  caption: string | null;
  width: number | null;
  height: number | null;
};

// Gallery grid whose photos open in a fullscreen lightbox — tap to zoom,
// swipe (or arrow keys) to move between photos, Escape or tap outside to close.
export default function PhotoGallery({
  photos,
  className,
  closeLabel,
  zoomLabel,
  banner,
}: {
  photos: GalleryPhoto[];
  className: string;
  closeLabel: string;
  zoomLabel: string;
  /** Marks every photo in the grid as demo content. */
  banner?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // Fullscreen shows the whole photo; zoomed fills the frame and scrolls.
  const [zoomed, setZoomed] = useState(false);
  const touchX = useRef<number | null>(null);

  const stepReset = () => setZoomed(false);

  const step = useCallback(
    (delta: number) => {
      setOpen((cur) =>
        cur === null ? cur : (cur + delta + photos.length) % photos.length
      );
    },
    [photos.length]
  );

  useEffect(() => {
    if (open === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, step]);

  return (
    <>
      <div className={className}>
        {photos.map((photo, i) => (
          <figure key={photo.id} className="gallery-item">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
            <img
              src={`/api/photos/${photo.id}`}
              alt={photo.caption ?? ""}
              loading="lazy"
              className="gallery-zoomable"
              onClick={() => setOpen(i)}
            />
            {banner && <span className="demo-banner">{banner}</span>}
            {photo.caption && <figcaption>{photo.caption}</figcaption>}
          </figure>
        ))}
      </div>
      {open !== null && (
        <div
          className="lightbox"
          onClick={() => setOpen(null)}
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const start = touchX.current;
            touchX.current = null;
            if (start === null) return;
            const dx = e.changedTouches[0].clientX - start;
            if (Math.abs(dx) > 40) {
              stepReset();
              step(dx > 0 ? -1 : 1);
            }
          }}
        >
          <figure
            className={`lightbox-figure${zoomed ? " zoomed" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
            <img
              src={`/api/photos/${photos[open].id}`}
              alt={photos[open].caption ?? ""}
              // Fit the screen by default; a click fills it and lets the frame
              // scroll, which is the only way to read a topo line on a photo.
              onClick={() => setZoomed((z) => !z)}
            />
            {photos[open].caption && (
              <figcaption className="lightbox-caption">{photos[open].caption}</figcaption>
            )}
          </figure>
          <button
            type="button"
            className="lightbox-zoom"
            aria-label={zoomLabel}
            title={zoomLabel}
            aria-pressed={zoomed}
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
          >
            {zoomed ? "－" : "＋"}
          </button>
          <button
            type="button"
            className="lightbox-close"
            aria-label={closeLabel}
            onClick={() => setOpen(null)}
          >
            ×
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav prev"
                aria-label="←"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="lightbox-nav next"
                aria-label="→"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
              >
                ›
              </button>
              <span className="lightbox-counter">
                {open + 1} / {photos.length}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
