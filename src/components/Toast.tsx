"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// A short confirmation that floats over the page and takes itself away. Used
// where the action succeeds somewhere the eye isn't — adding a route to a list
// from the middle of a long results page, say.
export default function Toast({
  message,
  onDone,
  ms,
  tone = "ok",
  action,
}: {
  message: string;
  onDone: () => void;
  ms?: number;
  tone?: "ok" | "error";
  /** One button beside the message, "Undo" say; the toast stays longer to leave time for it. */
  action?: { label: string; onClick: () => void };
}) {
  const stay = ms ?? (action ? 6500 : 3200);
  useEffect(() => {
    const timer = setTimeout(onDone, stay);
    return () => clearTimeout(timer);
  }, [onDone, stay]);

  // Rendered into <body>: anywhere else it inherits a stacking context and
  // gets painted under the page. Only ever mounted from an event handler, so
  // there is no server render to guard against.
  if (typeof document === "undefined") return null;

  return createPortal(
    <output className={`toast toast-${tone}${action ? " has-action" : ""}`}>
      <span>{message}</span>
      {action && (
        <button type="button" className="toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </output>,
    document.body
  );
}
