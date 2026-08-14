"use client";

import { useState } from "react";

/**
 * The mark on the button: the site's own summit, with the ridge carrying on
 * past the frame — sharing is this journal leaving the page it lives on.
 * Drawn rather than borrowed, because a chain link is every website's share
 * button and none of them are about mountains.
 *
 * `currentColor` throughout, so it takes the accent from the button around it
 * and needs no second version for a dark background.
 */
function ShareMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden focusable="false">
      {/* The skyline of the app icon: two summits and the notch between them. */}
      <path
        d="M2.5 19 L8 10 L11.5 15 L13.5 11.5 L17 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The same line, carrying on out of the frame — and its head. That is
          the whole idea: the journal leaving the page it lives on. */}
      <path
        d="M20.5 4.5 L13.5 11.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M14.5 4.5 L20.5 4.5 L20.5 10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// On phones, opens the native share sheet (WhatsApp, Messages…); elsewhere
// copies the page URL and flips to a ✓ for a moment as feedback.
export default function ShareButton({
  label,
  copied,
  text,
  small = false,
}: {
  label: string;
  copied: string;
  text?: string;
  /** Beside a heading rather than under a photo: same button, quieter. */
  small?: boolean;
}) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className={small ? "share-fab share-fab-sm" : "share-fab"}
      title={done ? copied : label}
      aria-label={label}
      onClick={async () => {
        const url = window.location.href;
        if (navigator.share) {
          try {
            // Embed the URL in the text rather than passing a separate `url`
            // field: apps like WhatsApp and Signal handle a split text/url
            // differently (some drop one, some duplicate the link), so a single
            // combined string is the only way to get identical output across
            // every target.
            const shareText = text ? `${text}\n${url}` : url;
            await navigator.share({ title: document.title, text: shareText });
          } catch {
            // User closed the share sheet — nothing to do.
          }
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard unavailable (old browser, missing permission) — leave the
          // button as is rather than pretending it copied.
        }
      }}
    >
      {done ? "✓" : <ShareMark />}
    </button>
  );
}
