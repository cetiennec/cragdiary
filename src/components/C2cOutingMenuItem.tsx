"use client";

import { useRouter } from "next/navigation";

// Import-menu entry for a single c2c outing: ask for the link, then open the
// editor pre-filling from it (fields + photos).
export default function C2cOutingMenuItem({
  label,
  promptText,
}: {
  label: string;
  promptText: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="action-menu-item"
      onClick={() => {
        const url = window.prompt(promptText);
        if (url && url.trim()) {
          router.push(`/entries/new?c2c=${encodeURIComponent(url.trim())}`);
        }
      }}
    >
      <span aria-hidden>🏔️</span> {label}
    </button>
  );
}
