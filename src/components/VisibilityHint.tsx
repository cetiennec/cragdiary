"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * What a visibility setting actually means, said once and then not again.
 *
 * The explanation matters the first time someone hides their journal and never
 * afterwards — a paragraph that stays put is a paragraph that stops being
 * read. Dismissed per setting, so switching from link-only to private still
 * explains the new one.
 *
 * Nothing is rendered before the browser has been asked — the server has no
 * localStorage to read, so it renders nothing and the client decides. That
 * costs a moment's delay for the people who haven't seen it, and spares
 * everyone else the flash of a notice they dismissed long ago.
 */
export default function VisibilityHint({
  value,
  text,
  dismissLabel,
}: {
  value: string;
  text: string;
  dismissLabel: string;
}) {
  const key = `cragdiary-visibility-hint-${value}`;
  // Read through `useSyncExternalStore` rather than an effect: the server has
  // no answer to give (hence the `true`, meaning "say nothing"), and the
  // browser's is read on the first client render.
  const alreadySeen = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => localStorage.getItem(key) === "1",
    () => true
  );
  const [justDismissed, setJustDismissed] = useState(false);

  if (alreadySeen || justDismissed) return null;

  return (
    <p className="form-hint profile-visibility-hint">
      {text}
      <button
        type="button"
        className="hint-dismiss"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={() => {
          localStorage.setItem(key, "1");
          setJustDismissed(true);
        }}
      >
        ✕
      </button>
    </p>
  );
}
