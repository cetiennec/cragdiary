"use client";

import { useFormStatus } from "react-dom";
import { deleteAccount, updateProfile } from "@/app/actions";
import { compressImage } from "@/lib/client-image";

type SettingsLabels = {
  bioLabel: string;
  avatarLabel: string;
  avatarRemove: string;
  visibilityLabel: string;
  visibilityOptions: { public: string; unlisted: string; private: string };
  privateHint: string;
  unlistedHint: string;
  settingsSave: string;
  emailLabel: string;
  emailHint: string;
  coverLabel: string;
  coverRemove: string;
  exportLabel: string;
  dangerTitle: string;
  deleteLabel: string;
  deleteConfirmPassword: string;
  deleteButton: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

async function shrinkOnChange(
  e: React.ChangeEvent<HTMLInputElement>,
  maxDimension: number
) {
  const input = e.target;
  const file = input.files?.[0];
  if (!file) return;
  const compressed = await compressImage(file, maxDimension, 0.85);
  const dt = new DataTransfer();
  dt.items.add(compressed);
  input.files = dt.files;
}

export default function ProfileSettingsForm({
  bio,
  email,
  visibility,
  hasAvatar,
  hasCover,
  t,
}: {
  bio: string;
  email: string;
  visibility: "public" | "unlisted" | "private";
  hasAvatar: boolean;
  hasCover: boolean;
  t: SettingsLabels;
}) {
  return (
    <>
      <form action={updateProfile} className="entry-form profile-settings-form">
        <label>
          {t.bioLabel}
          <textarea name="bio" rows={3} defaultValue={bio} />
        </label>
        <label>
          {t.emailLabel}
          <input type="email" name="email" defaultValue={email} autoComplete="email" />
        </label>
        <p className="form-hint">{t.emailHint}</p>
        <label>
          {t.avatarLabel}
          <input type="file" name="avatar" accept="image/*" onChange={(e) => shrinkOnChange(e, 800)} />
        </label>
        {hasAvatar && (
          <label className="profile-public-toggle">
            <input type="checkbox" name="remove_avatar" value="1" /> {t.avatarRemove}
          </label>
        )}
        <label>
          {t.coverLabel}
          <input type="file" name="cover" accept="image/*" onChange={(e) => shrinkOnChange(e, 1600)} />
        </label>
        {hasCover && (
          <label className="profile-public-toggle">
            <input type="checkbox" name="remove_cover" value="1" /> {t.coverRemove}
          </label>
        )}
        <label>
          {t.visibilityLabel}
          <select name="profile_visibility" defaultValue={visibility}>
            <option value="public">{t.visibilityOptions.public}</option>
            <option value="unlisted">{t.visibilityOptions.unlisted}</option>
            <option value="private">{t.visibilityOptions.private}</option>
          </select>
        </label>
        {visibility === "private" && <p className="form-hint">{t.privateHint}</p>}
        {visibility === "unlisted" && <p className="form-hint">{t.unlistedHint}</p>}
        <SubmitButton label={t.settingsSave} />
      </form>

      <p className="export-link">
        <a href="/api/export">⬇︎ {t.exportLabel}</a>
      </p>

      <div className="danger-zone">
        <p className="danger-title">{t.dangerTitle}</p>
        <p className="form-hint">{t.deleteLabel}</p>
        <form
          action={deleteAccount}
          className="entry-form"
          onSubmit={(e) => {
            if (!confirm(t.deleteLabel)) e.preventDefault();
          }}
        >
          <label>
            {t.deleteConfirmPassword}
            <input type="password" name="confirm_password" required autoComplete="current-password" />
          </label>
          <button type="submit" className="btn-danger">
            {t.deleteButton}
          </button>
        </form>
      </div>
    </>
  );
}
