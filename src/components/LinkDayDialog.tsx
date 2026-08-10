"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { LinkableDay } from "@/app/api/entries/linkable/route";

export type LinkDayLabels = {
  title: string; // "@lea logged this day too"
  intro: string;
  sameDate: string; // already the same date — nothing to change
  willMoveDate: string; // "your day will be dated {date}"
  link: string;
  ignore: string;
  alreadyLinked: string;
  /** Confirmation once linked. */
  linked: string;
};

// Offered when you tag someone who logged a day around the same date: two days
// are linked by the same date plus a mention, so the mention you just made does
// half the work and this settles the other half.
export default function LinkDayDialog({
  username,
  days,
  currentDate,
  t,
  onLink,
  onClose,
}: {
  username: string;
  days: LinkableDay[];
  currentDate: string;
  t: LinkDayLabels;
  onLink: (day: LinkableDay) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="welcome-overlay" onClick={onClose}>
      <div
        className="welcome-card link-day"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="page-subtitle">{t.title.replace("{user}", username)}</h2>
        <p className="form-hint">{t.intro}</p>

        <ul className="link-day-list">
          {days.map((day) => (
            <li key={day.id} className="link-day-row">
              {day.photo_id ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own DB-backed route
                <img
                  src={`/api/photos/${day.photo_id}?t=1`}
                  alt=""
                  className="link-day-thumb"
                  loading="lazy"
                />
              ) : (
                <span className="link-day-thumb link-day-thumb-empty" aria-hidden />
              )}
              <span className="link-day-text">
                <strong>{day.crag}</strong>
                <span className="link-day-meta">
                  {day.entry_date}
                  {day.location ? ` · ${day.location}` : ""}
                </span>
                <span className="link-day-meta">
                  {day.already_linked
                    ? t.alreadyLinked
                    : day.entry_date === currentDate
                      ? t.sameDate
                      : t.willMoveDate.replace("{date}", day.entry_date)}
                </span>
              </span>
              <button type="button" className="follower-accept" onClick={() => onLink(day)}>
                {t.link}
              </button>
            </li>
          ))}
        </ul>

        <div className="import-options-actions">
          <button type="button" className="filter-clear" onClick={onClose}>
            {t.ignore}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
