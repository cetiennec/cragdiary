"use client";

import { useRef, useState } from "react";
import { updateAvatar } from "@/app/actions";
import { compressImage } from "@/lib/client-image";

/**
 * The profile picture, on your own profile, as the way to change it.
 *
 * Looking at your own photograph and wanting a different one is the whole
 * thought — needing to remember it lives inside a settings panel is a step
 * that only ever existed because the form did. Shrunk in the browser first,
 * like every other upload here, so a phone photograph doesn't travel at full
 * size to be cropped to 320 px at the far end.
 */
export default function AvatarPicker({
  username,
  hasAvatar,
  initial,
  label,
}: {
  username: string;
  hasAvatar: boolean;
  /** The letter shown when there is no photograph yet. */
  initial: string;
  label: string;
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
      <label className="profile-avatar" title={label} aria-label={label}>
        {hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own DB-backed route, already resized
          <img src={`/api/avatars/${username}`} alt="" />
        ) : (
          initial
        )}
        <input
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
      </label>
      {/* Outside the photograph, not inside it: the avatar clips whatever it
          contains to a circle, which swallowed the badge's own edge. */}
      <span className="avatar-picker-hint" aria-hidden>
        {busy ? "…" : "✎"}
      </span>
    </form>
  );
}
