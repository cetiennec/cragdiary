"use client";

import { useCallback, useEffect, useRef } from "react";
import { useZoomPan } from "@/lib/use-zoom-pan";

export type GalleryPhoto = {
  id: string;
  caption: string | null;
  width: number | null;
  height: number | null;
};

// The fullscreen viewer: tap to zoom, swipe (or arrow keys) to move between
// photos, Escape or tap outside to close. Shared by the gallery under a day
// and by the photos set inside its story, so both open the same way.
export default function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  closeLabel,
  zoomLabel,
}: {
  photos: GalleryPhoto[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  closeLabel: string;
  zoomLabel: string;
}) {
  const touchX = useRef<number | null>(null);
  // Fullscreen shows the whole photo; zoomed fills the frame and scrolls, and
  // a mouse or a thumb can drag it around — see useZoomPan, which the profile
  // photograph borrows word for word.
  const {
    zoomed,
    zoomWidth,
    frameRef,
    imgRef,
    panHandlers,
    toggle: toggleZoom,
    reset: stepReset,
    wasDrag,
  } = useZoomPan();

  const step = useCallback(
    (delta: number) => {
      onIndexChange((index + delta + photos.length) % photos.length);
    },
    [index, photos.length, onIndexChange]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [step, onClose]);

  const photo = photos[index];
  if (!photo) return null;

  return (
    <div
      className="lightbox"
      onClick={onClose}
      onTouchStart={(e) => {
        // Zoomed, a swipe belongs to the photo, not to the gallery.
        touchX.current = zoomed ? null : e.touches[0].clientX;
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
        ref={frameRef}
        className={`lightbox-figure${zoomed ? " zoomed" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          // A drag ends with a click; only a still pointer toggles.
          if (wasDrag()) return;
          toggleZoom();
        }}
        {...panHandlers}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
        <img
          ref={imgRef}
          src={`/api/photos/${photo.id}`}
          alt={photo.caption ?? ""}
          style={zoomed && zoomWidth ? { width: `${zoomWidth}px` } : undefined}
        />
        {photo.caption && <figcaption className="lightbox-caption">{photo.caption}</figcaption>}
      </figure>
      <button
        type="button"
        className="lightbox-zoom"
        aria-label={zoomLabel}
        title={zoomLabel}
        aria-pressed={zoomed}
        onClick={(e) => {
          e.stopPropagation();
          toggleZoom();
        }}
      >
        {zoomed ? "－" : "＋"}
      </button>
      <button type="button" className="lightbox-close" aria-label={closeLabel} onClick={onClose}>
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
            {index + 1} / {photos.length}
          </span>
        </>
      )}
    </div>
  );
}
