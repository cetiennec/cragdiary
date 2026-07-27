"use client";

import { useEffect, useState } from "react";

type WelcomeDict = {
  title: string;
  intro: string;
  close: string;
  items: [string, string, string][];
};

const SEEN_KEY = "cragdiary-welcome-v1";

// One-time welcome popup shown on a fresh account (first visit in this
// browser). Explains the main features; dismissed forever via localStorage.
export default function WelcomeTour({ t }: { t: WelcomeDict }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      // localStorage unavailable — just don't show it.
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="welcome-title">{t.title}</h2>
        <p className="welcome-intro">{t.intro}</p>
        <ul className="welcome-list">
          {t.items.map(([icon, title, desc]) => (
            <li key={title}>
              <span className="welcome-icon" aria-hidden>
                {icon}
              </span>
              <span className="welcome-text">
                <strong>{title}</strong>
                {desc}
              </span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-primary welcome-close" onClick={dismiss}>
          {t.close}
        </button>
      </div>
    </div>
  );
}
