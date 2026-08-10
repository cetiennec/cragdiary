"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// A short confirmation that floats over the page and takes itself away. Used
// where the action succeeds somewhere the eye isn't — adding a route to a list
// from the middle of a long results page, say.
export default function Toast({
  message,
  onDone,
  ms = 3200,
  tone = "ok",
}: {
  message: string;
  onDone: () => void;
  ms?: number;
  tone?: "ok" | "error";
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [onDone, ms]);

  // Rendered into <body>: anywhere else it inherits a stacking context and
  // gets painted under the page. Only ever mounted from an event handler, so
  // there is no server render to guard against.
  if (typeof document === "undefined") return null;

  return createPortal(
    <output className={`toast toast-${tone}`}>{message}</output>,
    document.body
  );
}
