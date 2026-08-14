"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteAccount, updateProfile } from "@/app/actions";
import { compressImage } from "@/lib/client-image";

type SettingsLabels = {
  bioLabel: string;
  bioPinsHint: string;
  avatarLabel: string;
  avatarRemove: string;
  settingsSave: string;
  emailLabel: string;
  emailHint: string;
  c2cAccountFieldLabel: string;
  c2cAccountFieldHint: string;
  websiteLabel: string;
  websiteHint: string;
  coverLabel: string;
  coverRemove: string;
  exportLabel: string;
  exportCarnetLabel: string;
  importLabel: string;
  importC2cAccountLabel: string;
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

// Visibility is deliberately not here — it lives in the profile header, where
// you can see and change it without unfolding settings.
export default function ProfileSettingsForm({
  bio,
  email,
  website,
  c2cProfileId,
  hasAvatar,
  hasCover,
  pinSuggestions = [],
  t,
}: {
  bio: string;
  website: string;
  email: string;
  c2cProfileId: number | null;
  hasAvatar: boolean;
  hasCover: boolean;
  pinSuggestions?: string[];
  t: SettingsLabels;
}) {
  const [bioValue, setBioValue] = useState(bio);

  // One click drops an earned pin into the bio; a second click takes it out.
  function togglePin(emoji: string) {
    setBioValue((v) =>
      v.includes(emoji) ? v.replace(emoji, "").replace(/  +/g, " ").trim() : v ? `${v} ${emoji}` : emoji
    );
  }

  return (
    <>
      <form action={updateProfile} className="entry-form profile-settings-form">
        <label>
          {t.bioLabel}
          <textarea
            name="bio"
            rows={3}
            value={bioValue}
            onChange={(e) => setBioValue(e.target.value)}
          />
        </label>
        {pinSuggestions.length > 0 && (
          <>
            <p className="form-hint">{t.bioPinsHint}</p>
            <div className="bio-pins">
              {pinSuggestions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`pin-badge${bioValue.includes(emoji) ? " in-bio" : ""}`}
                  aria-pressed={bioValue.includes(emoji)}
                  onClick={() => togglePin(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
        <label>
          {t.emailLabel}
          <input type="email" name="email" defaultValue={email} autoComplete="email" />
        </label>
        <p className="form-hint">{t.emailHint}</p>
        <label>
          {t.websiteLabel}
          <input
            type="url"
            name="website"
            defaultValue={website}
            placeholder="https://…"
            autoComplete="url"
            inputMode="url"
          />
        </label>
        <p className="form-hint">{t.websiteHint}</p>
        <label>
          {t.c2cAccountFieldLabel}
          <input
            type="text"
            name="c2c_profile"
            defaultValue={c2cProfileId ? `https://www.camptocamp.org/profiles/${c2cProfileId}` : ""}
            placeholder="https://www.camptocamp.org/profiles/123456"
            autoComplete="off"
          />
        </label>
        <p className="form-hint">{t.c2cAccountFieldHint}</p>
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
        <SubmitButton label={t.settingsSave} />
      </form>

      <p className="export-link">
        <a href="/api/export">⬇︎ {t.exportLabel}</a> ·{" "}
        <a href="/api/carnet">⬇︎ {t.exportCarnetLabel}</a>{" "}
        ·{" "}
        <a href="/import">⬆︎ {t.importLabel}</a> ·{" "}
        <a href="/import#c2c-account">🏔️ {t.importC2cAccountLabel}</a>
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
