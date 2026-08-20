"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Enlarging a picture inside a fullscreen frame, and dragging it around once
 * it no longer fits.
 *
 * Written for the entry gallery and then wanted, word for word, by the profile
 * photograph — the fiddly parts are the same wherever a picture is bigger than
 * its frame: a drag ends with a click, which must not be read as a tap; a
 * pointer capture is needed or the drag stops the moment it leaves the image;
 * and the zoom is measured against what is actually on screen, not against the
 * window, since a tall picture is already fitted to the height.
 */
export function useZoomPan() {
  const [zoomed, setZoomed] = useState(false);
  // The width to show at, once zoomed: twice the size it was displayed at.
  const [zoomWidth, setZoomWidth] = useState<number | null>(null);
  const frameRef = useRef<HTMLElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const moved = useRef(false);

  // Both are stable, so an effect may depend on them without re-running on
  // every render.
  const toggle = useCallback(() => {
    setZoomed((was) => {
      if (!was && imgRef.current) {
        setZoomWidth(Math.round(imgRef.current.getBoundingClientRect().width * 2));
      }
      return !was;
    });
  }, []);

  /** Back to fitting the frame — what moving to another picture wants. */
  const reset = useCallback(() => {
    setZoomed(false);
    setZoomWidth(null);
  }, []);

  // Spread onto the <figure>: the frame that scrolls, and the thing being
  // dragged. The click handler is the caller's, since only it knows what a
  // click outside the picture should do.
  const panHandlers = {
    onPointerDown(e: React.PointerEvent) {
      if (!zoomed || !frameRef.current) return;
      frameRef.current.setPointerCapture(e.pointerId);
      moved.current = false;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        left: frameRef.current.scrollLeft,
        top: frameRef.current.scrollTop,
      };
    },
    onPointerMove(e: React.PointerEvent) {
      const from = drag.current;
      if (!from || !frameRef.current) return;
      if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 4) {
        moved.current = true;
      }
      frameRef.current.scrollLeft = from.left - (e.clientX - from.x);
      frameRef.current.scrollTop = from.top - (e.clientY - from.y);
    },
    onPointerUp(e: React.PointerEvent) {
      frameRef.current?.releasePointerCapture(e.pointerId);
      drag.current = null;
    },
    onPointerCancel() {
      drag.current = null;
    },
  };

  /** True when the click that just happened was the end of a drag. */
  function wasDrag() {
    if (!moved.current) return false;
    moved.current = false;
    return true;
  }

  return { zoomed, zoomWidth, frameRef, imgRef, panHandlers, toggle, reset, wasDrag };
}
