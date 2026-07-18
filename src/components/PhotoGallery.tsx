"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Gallery grid whose photos open in a fullscreen lightbox — tap to zoom,
// swipe (or arrow keys) to move between photos, Escape or tap outside to close.
export default function PhotoGallery({
  photoIds,
  className,
  closeLabel,
}: {
  photoIds: string[];
  className: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);

  const step = useCallback(
    (delta: number) => {
      setOpen((cur) =>
        cur === null ? cur : (cur + delta + photoIds.length) % photoIds.length
      );
    },
    [photoIds.length]
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
        {photoIds.map((id, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side
          <img
            key={id}
            src={`/api/photos/${id}`}
            alt=""
            loading="lazy"
            className="gallery-zoomable"
            onClick={() => setOpen(i)}
          />
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
            if (Math.abs(dx) > 40) step(dx > 0 ? -1 : 1);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
          <img
            src={`/api/photos/${photoIds[open]}`}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="lightbox-close"
            aria-label={closeLabel}
            onClick={() => setOpen(null)}
          >
            ×
          </button>
          {photoIds.length > 1 && (
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
                {open + 1} / {photoIds.length}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
