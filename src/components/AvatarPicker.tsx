"use client";

import { useRef, useState } from "react";
import { updateAvatar } from "@/app/actions";
import AvatarZoom from "@/components/AvatarZoom";
import { compressImage } from "@/lib/client-image";

/**
 * The profile picture, on your own profile: both things you might want from it.
 *
 * Pressing the photograph enlarges it, exactly as it does on anybody else's
 * page — the pencil beside it is what changes it. That split arrived after the
 * whole circle was the file picker and there was no way left to simply look at
 * your own face. With no photograph yet there is nothing to enlarge, so the
 * circle goes back to being the picker itself.
 *
 * Shrunk in the browser first, like every other upload here, so a phone
 * photograph doesn't travel at full size to be cropped at the far end.
 */
export default function AvatarPicker({
  username,
  hasAvatar,
  initial,
  label,
  zoomLabel,
  zoomCloseLabel,
  enlargeLabel,
}: {
  username: string;
  hasAvatar: boolean;
  /** The letter shown when there is no photograph yet. */
  initial: string;
  label: string;
  zoomLabel: string;
  zoomCloseLabel: string;
  /** The ＋ inside the opened frame — the gallery's own word for it. */
  enlargeLabel: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      ref={formRef}
      action={async (formData: FormData) => {
        setBusy(true);
        try {
          await updateAvatar(formData);
        } finally {
          setBusy(false);
        }
      }}
      className="avatar-picker"
    >
      {hasAvatar ? (
        <AvatarZoom
          username={username}
          hasAvatar
          initial={initial}
          label={zoomLabel}
          closeLabel={zoomCloseLabel}
          zoomLabel={enlargeLabel}
        />
      ) : (
        <label className="profile-avatar" title={label} aria-label={label}>
          {initial}
        </label>
      )}
      <input
        id="avatar-file"
        type="file"
        name="avatar"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const smaller = await compressImage(file, 800, 0.85);
          const dt = new DataTransfer();
          dt.items.add(smaller);
          e.target.files = dt.files;
          formRef.current?.requestSubmit();
        }}
      />
      {/* Outside the photograph, not inside it: the avatar clips whatever it
          contains to a circle, which swallowed the badge's own edge. Its own
          control now rather than decoration, since the circle it sits on has
          been given the other job. */}
      <label className="avatar-picker-hint" htmlFor="avatar-file" title={label} aria-label={label}>
        {busy ? "\u2026" : "\u270e"}
      </label>
    </form>
  );
}
