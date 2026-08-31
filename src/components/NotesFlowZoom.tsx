"use client";

import { useState, type ReactNode } from "react";
import PhotoLightbox, { type GalleryPhoto } from "@/components/PhotoLightbox";

// The story of a day, with the photos set inside it opening full screen like
// the ones in the gallery below. The paragraphs and figures are rendered on
// the server; this only listens for a click on one of them, so nothing about
// the text has to become client-side to make a picture zoomable.
export default function NotesFlowZoom({
  photos,
  closeLabel,
  zoomLabel,
  children,
}: {
  photos: GalleryPhoto[];
  closeLabel: string;
  zoomLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <div
        className="notes-flow"
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest<HTMLElement>("img[data-photo-id]");
          if (!img) return;
          const i = photos.findIndex((p) => p.id === img.dataset.photoId);
          if (i >= 0) setOpen(i);
        }}
      >
        {children}
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
