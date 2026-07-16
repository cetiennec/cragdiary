"use client";

import { useFormStatus } from "react-dom";
import { updateProfile } from "@/app/actions";
import { compressImage } from "@/lib/client-image";

type SettingsLabels = {
  bioLabel: string;
  avatarLabel: string;
  avatarRemove: string;
  publicLabel: string;
  privateHint: string;
  settingsSave: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export default function ProfileSettingsForm({
  bio,
  isPublic,
  hasAvatar,
  t,
}: {
  bio: string;
  isPublic: boolean;
  hasAvatar: boolean;
  t: SettingsLabels;
}) {
  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file, 800, 0.85);
    const dt = new DataTransfer();
    dt.items.add(compressed);
    input.files = dt.files;
  }

  return (
    <form action={updateProfile} className="entry-form profile-settings-form">
      <label>
        {t.bioLabel}
        <textarea name="bio" rows={3} defaultValue={bio} />
      </label>
      <label>
        {t.avatarLabel}
        <input type="file" name="avatar" accept="image/*" onChange={handleAvatarFile} />
      </label>
      {hasAvatar && (
        <label className="profile-public-toggle">
          <input type="checkbox" name="remove_avatar" value="1" /> {t.avatarRemove}
        </label>
      )}
      <label className="profile-public-toggle">
        <input type="checkbox" name="is_public" value="1" defaultChecked={isPublic} />{" "}
        {t.publicLabel}
      </label>
      {!isPublic && <p className="form-hint">{t.privateHint}</p>}
      <SubmitButton label={t.settingsSave} />
    </form>
  );
}
