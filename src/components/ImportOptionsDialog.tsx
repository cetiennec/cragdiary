"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Visibility = "public" | "unlisted" | "private";

export type ImportOptionsLabels = {
  title: string;
  intro: string; // "{n} outings will be added…"
  visibilityLabel: string;
  public: string;
  unlisted: string;
  private: string;
  photos: string;
  confirm: string;
  cancel: string;
};

// Asked before a batch import, because visibility is the one choice that is
// tedious to undo afterwards — every imported day would have to be changed by
// hand. Link-only is the default: shareable, but off the public feed.
export default function ImportOptionsDialog({
  count,
  defaultVisibility = "unlisted",
  defaultPhotos = true,
  t,
  onCancel,
  onConfirm,
}: {
  count: number;
  defaultVisibility?: Visibility;
  defaultPhotos?: boolean;
  t: ImportOptionsLabels;
  onCancel: () => void;
  onConfirm: (choice: { visibility: Visibility; withPhotos: boolean }) => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [withPhotos, setWithPhotos] = useState(defaultPhotos);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Escape closes it, and focus starts on the confirm button so the keyboard
  // alone can answer.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const options: [Visibility, string][] = [
    ["public", t.public],
    ["unlisted", t.unlisted],
    ["private", t.private],
  ];

  // Rendered into <body>: nested where it's used, the overlay lands inside a
  // stacking context and the page's own controls paint straight over it. Only
  // ever opened from a click, so there is no server render to guard against —
  // but a missing document would throw, so say so plainly.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="welcome-overlay" onClick={onCancel}>
      <div
        className="welcome-card import-options"
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="page-subtitle">{t.title}</h2>
        <p className="form-hint">{t.intro.replace("{n}", String(count))}</p>

        <fieldset className="import-options-choices">
          <legend className="form-hint">{t.visibilityLabel}</legend>
          {options.map(([value, label]) => (
            <label key={value} className="import-options-choice">
              <input
                type="radio"
                name="import-visibility"
                value={value}
                checked={visibility === value}
                onChange={() => setVisibility(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <label className="import-options-choice">
          <input
            type="checkbox"
            checked={withPhotos}
            onChange={(e) => setWithPhotos(e.target.checked)}
          />
          <span>{t.photos}</span>
        </label>

        <div className="import-options-actions">
          <button type="button" className="filter-clear" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="btn-primary"
            onClick={() => onConfirm({ visibility, withPhotos })}
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
