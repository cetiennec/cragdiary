"use client";

import { useState } from "react";

/**
 * The ordinary share mark — an arrow leaving its frame. Drawn rather than
 * taken from the emoji font so it takes the button's own colour and looks the
 * same everywhere, where 🔗 is a chain on one platform and a paperclip on the
 * next.
 */
function ShareMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden focusable="false">
      {/* The frame this page is, left open where the arrow goes out of it. */}
      <path
        d="M10 5 H5.5 A1.5 1.5 0 0 0 4 6.5 v12 A1.5 1.5 0 0 0 5.5 20 h12 A1.5 1.5 0 0 0 19 18.5 V14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 4 H20 V10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20 4 L11.5 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
