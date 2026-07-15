"use client";

import { useEffect, useState } from "react";

type Theme = "scrapbook" | "minimal";

const STORAGE_KEY = "cragdiary-theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Reads the value the inline head script already set on <html> before hydration,
    // so this only runs once to sync client state — not a reactive update loop.
    const current = document.documentElement.getAttribute("data-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current === "minimal" ? "minimal" : "scrapbook");
  }, []);

  function applyTheme(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  if (!theme) return <div className="theme-toggle" aria-hidden style={{ visibility: "hidden" }} />;

  return (
    <div className="theme-toggle" role="group" aria-label="Visual style">
      <button
        type="button"
        data-active={theme === "scrapbook"}
        onClick={() => applyTheme("scrapbook")}
      >
        Scrapbook
      </button>
      <button
        type="button"
        data-active={theme === "minimal"}
        onClick={() => applyTheme("minimal")}
      >
        Minimal
      </button>
    </div>
  );
}
