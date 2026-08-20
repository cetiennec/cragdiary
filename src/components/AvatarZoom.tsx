"use client";

import { useEffect, useState } from "react";

/**
 * Someone else's photograph, at the size it was actually taken.
 *
 * A 64 px circle is a name badge, not a face. Pressing it opens the same
 * fullscreen frame the entry photographs use, so a profile picture can be
 * looked at rather than merely recognised. Your own photograph keeps its own
 * job — pressing it changes it — so this is only ever for other people's.
 */
export default function AvatarZoom({
  username,
  hasAvatar,
  initial,
  label,
  closeLabel,
}: {
  username: string;
  hasAvatar: boolean;
  /** The letter shown when there is no photograph yet. */
  initial: string;
  label: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  // Nothing to enlarge: a letter is already as large as it will ever be.
  if (!hasAvatar) {
    return (
      <div className="profile-avatar" aria-hidden>
        {initial}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="profile-avatar avatar-zoom"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized server-side */}
        <img src={`/api/avatars/${username}`} alt="" />
      </button>
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)}>
          <figure className="lightbox-figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- our own DB-backed route */}
            <img
              className="avatar-zoom-full"
              src={`/api/avatars/${username}`}
              alt={username}
              onClick={(e) => e.stopPropagation()}
            />
          </figure>
          <button
            type="button"
            className="lightbox-close"
            aria-label={closeLabel}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
