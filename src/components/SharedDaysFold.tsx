"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const SEEN_KEY = "cragdiary-seen-shared-days";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: string[]) {
  try {
    const all = [...new Set([...readSeen(), ...ids])].slice(-500);
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // Private window: the fold simply opens again next time.
  }
}

/**
 * "Les journées où vous apparaissez", folded unless there is something new in
 * it: an invitation to answer (decided on the server, so it holds on any
 * device), or a day this browser has not shown you yet. Opening it — by hand,
 * or through the profile's tab — counts as having seen what is there.
 */
export default function SharedDaysFold({
  ids,
  urgent,
  summary,
  newLabel,
  children,
}: {
  ids: string[];
  /** Something waits for an answer: open whatever this browser remembers. */
  urgent: boolean;
  summary: ReactNode;
  newLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    const seen = readSeen();
    const unseen = ids.filter((id) => !seen.has(id)).length;
    const el = ref.current;
    if (!el) return;
    setFresh(unseen);
    if (unseen > 0 || location.hash === "#shared-days") el.open = true;
    const onHash = () => {
      if (location.hash === "#shared-days") el.open = true;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [ids]);

  return (
    <details
      ref={ref}
      className="shared-days-fold"
      open={urgent}
      onToggle={(e) => {
        if (e.currentTarget.open) writeSeen(ids);
      }}
    >
      <summary>
        {summary}
        {fresh > 0 && <span className="shared-days-new">{newLabel.replace("{n}", String(fresh))}</span>}
      </summary>
      {children}
    </details>
  );
}
