"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Visibility = "public" | "unlisted" | "private";

export type ImportOptionsLabels = {
  title: string;
  titleComplete: string;
  intro: string; // "{n} outings will be added…"
  /** Used when nothing is new and the point is to complete what's there. */
  introComplete: string;
  visibilityLabel: string;
  public: string;
  unlisted: string;
  private: string;
  photos: string;
  /** "Complete the {n} days already imported…" — offered when there are any. */
  complete: string;
  /** "{n} already imported will be completed, not duplicated." */
  completeNote: string;
  confirm: string;
  cancel: string;
};

// Asked before a batch import, because visibility is the one choice that is
// tedious to undo afterwards — every imported day would have to be changed by
// hand. Link-only is the default: shareable, but off the public feed.
export default function ImportOptionsDialog({
  count,
  existingCount = 0,
  askComplete = false,
  defaultVisibility = "unlisted",
  defaultPhotos = true,
  t,
  onCancel,
  onConfirm,
}: {
  /** How many days will be added. */
  count: number;
  /** How many of them are already in the journal. */
  existingCount?: number;
  /** Offer completing them as a choice, rather than stating it as a fact. */
  askComplete?: boolean;
  defaultVisibility?: Visibility;
  defaultPhotos?: boolean;
  t: ImportOptionsLabels;
  onCancel: () => void;
  onConfirm: (choice: {
    visibility: Visibility;
    withPhotos: boolean;
    complete: boolean;
  }) => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>(defaultVisibility);
  const [withPhotos, setWithPhotos] = useState(defaultPhotos);
  const [complete, setComplete] = useState(false);
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
        <h2 className="page-subtitle">{count > 0 ? t.title : t.titleComplete}</h2>
        <p className="form-hint">
          {(count > 0 ? t.intro : t.introComplete).replace("{n}", String(count || existingCount))}
        </p>

        {/* Visibility only decides how *new* days appear; completing one never
            changes what it was set to. */}
        {count > 0 && (
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
        )}

        <label className="import-options-choice">
          <input
            type="checkbox"
            checked={withPhotos}
            onChange={(e) => setWithPhotos(e.target.checked)}
          />
          <span>{t.photos}</span>
        </label>

        {existingCount > 0 &&
          (askComplete ? (
            <label className="import-options-choice">
              <input
                type="checkbox"
                checked={complete}
                onChange={(e) => setComplete(e.target.checked)}
              />
              <span>{t.complete.replace("{n}", String(existingCount))}</span>
            </label>
          ) : (
            <p className="form-hint">
              {t.completeNote.replace("{n}", String(existingCount))}
            </p>
          ))}

        <div className="import-options-actions">
          <button type="button" className="filter-clear" onClick={onCancel}>
            {t.cancel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="btn-primary"
            onClick={() =>
              onConfirm({ visibility, withPhotos, complete: askComplete ? complete : true })
            }
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
