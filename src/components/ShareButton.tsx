"use client";

import { useState } from "react";

// On phones, opens the native share sheet (WhatsApp, Messages…); elsewhere
// copies the page URL and flips to a ✓ for a moment as feedback.
export default function ShareButton({ label, copied }: { label: string; copied: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="share-fab"
      title={done ? copied : label}
      aria-label={label}
      onClick={async () => {
        const url = window.location.href;
        if (navigator.share) {
          try {
            await navigator.share({ url, title: document.title });
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
      {done ? "✓" : "🔗"}
    </button>
  );
}
