"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";

const KEY = "cragdiary-shared-days-dismissed";

/**
 * The nudge at the top of your own journal, and the ✕ that puts it away.
 *
 * Dismissal is keyed on *which* days it is about, not on the fact of having
 * dismissed it once: put this one away and it stays away, but the next
 * invitation is a different set and speaks up again. Nothing is lost either
 * way — the days themselves are in the tray at the foot of the page, which is
 * where the banner points.
 *
 * Per browser rather than per account: it is a reminder, not a record, and it
 * is not worth a column. Every read and write is guarded, since a browser set
 * to refuse site data throws on the accessor itself rather than returning null.
 */
function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener("cragdiary-banner-dismissed", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("cragdiary-banner-dismissed", onChange);
  };
}

export default function SharedDaysBanner({
  ids,
  message,
  linkLabel,
  dismissLabel,
}: {
  /** The days this banner is about; the set is what a dismissal remembers. */
  ids: string[];
  message: string;
  linkLabel: string;
  dismissLabel: string;
}) {
  const key = [...ids].sort().join(",");
  // Server-rendered as "not dismissed", which is also what a browser with no
  // stored value reports — so the first paint agrees with itself either way.
  const dismissed = useSyncExternalStore(
    subscribe,
    () => read() === key,
    () => false
  );

  const hide = useCallback(() => {
    try {
      window.localStorage.setItem(KEY, key);
    } catch {
      /* nothing stored, so the banner simply comes back next time */
    }
    window.dispatchEvent(new Event("cragdiary-banner-dismissed"));
  }, [key]);

  if (ids.length === 0 || dismissed) return null;

  return (
    <p className="shared-days-banner">
      <span>
        {message} <Link href="#shared-days">{linkLabel}</Link>
      </span>
      <button type="button" className="shared-days-dismiss" onClick={hide} title={dismissLabel} aria-label={dismissLabel}>
        ✕
      </button>
    </p>
  );
}
