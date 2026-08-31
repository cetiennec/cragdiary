"use client";

import { useState } from "react";
import PhotoLightbox, { type GalleryPhoto } from "@/components/PhotoLightbox";

export type { GalleryPhoto };

// Gallery grid whose photos open in the fullscreen lightbox.
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
        <PhotoLightbox
          photos={photos}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          closeLabel={closeLabel}
          zoomLabel={zoomLabel}
        />
      )}
    </>
  );
}
