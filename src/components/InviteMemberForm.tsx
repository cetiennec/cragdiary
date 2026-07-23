"use client";

import { useEffect, useRef, useState } from "react";
import { addWishlistMember } from "@/app/actions";
import type { UserSuggestion } from "@/app/api/users/search/route";

// Invite-a-collaborator field with an @-search over public climbers only
// (the search API filters to public profiles). Unlisted users aren't surfaced
// — they must be typed in full — and private users can't be added at all.
export default function InviteMemberForm({
  listId,
  t,
}: {
  listId: string;
  t: { invite: string; invitePlaceholder: string };
}) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim().replace(/^@/, "");
    const timer = setTimeout(async () => {
      if (term.length < 1) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { results: UserSuggestion[] };
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setHighlighted(-1);
      } catch {
        // silent
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  function pick(s: UserSuggestion) {
    setQ(s.username);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <form action={addWishlistMember} className="member-invite">
      <input type="hidden" name="id" value={listId} />
      <div className="combobox">
        <input
          type="text"
          name="invitee"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, -1));
            } else if (e.key === "Enter" && highlighted >= 0) {
              e.preventDefault();
              pick(suggestions[highlighted]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t.invitePlaceholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          maxLength={20}
        />
        {open && (
          <ul className="combobox-list" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.username}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  data-highlighted={i === highlighted}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  <span className="combobox-title">@{s.username}</span>
                  <span className="combobox-meta">{s.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit">{t.invite}</button>
    </form>
  );
}
