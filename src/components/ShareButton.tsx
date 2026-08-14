"use client";

import { useState } from "react";

/**
 * The ordinary share mark — a box with an arrow leaving it, the one every
 * phone puts on its share sheet. Drawn rather than an emoji so it takes the
 * button's own colour and stays the same on every platform, where 🔗 is a
 * chain on one and a paperclip on the next.
 */
function ShareMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden focusable="false">
      <path d="M12 3.5 L12 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8.6 6.9 L12 3.4 L15.4 6.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.5 H5.5 A1.5 1.5 0 0 0 4 12 v7 A1.5 1.5 0 0 0 5.5 20.5 h13 A1.5 1.5 0 0 0 20 19 v-7 A1.5 1.5 0 0 0 18.5 10.5 h-1"
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
