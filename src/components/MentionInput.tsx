"use client";

import { useRef, useState } from "react";
import type { UserSuggestion } from "@/app/api/users/search/route";

// A text field where typing @ offers the climbers you can reach. Used wherever
// partners are written down — the entry editor has its own copy wired into a
// larger form, everything else uses this.
export default function MentionInput({
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
}: {
  name: string;
  /** Controlled use; leave out for an uncontrolled field with `defaultValue`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ?? defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const token = useRef<{ start: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = value ?? text;

  function set(next: string) {
    setText(next);
    onChange?.(next);
  }

  function detect(next: string, caret: number) {
    const match = /@([a-z0-9-]*)$/i.exec(next.slice(0, caret));
    if (!match) {
      token.current = null;
      setOpen(false);
      return;
    }
    token.current = { start: match.index };
    if (match[1].length < 1) {
      setOpen(false);
      return;
    }
    fetch(`/api/users/search?q=${encodeURIComponent(match[1])}`)
      .then((res) => res.json())
      .then((data: { results: UserSuggestion[] }) => {
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setHighlighted(-1);
      })
      .catch(() => {
        // No menu is a fine outcome — the field still takes free text.
      });
  }

  function apply(s: UserSuggestion) {
    const start = token.current?.start;
    if (start === undefined) return;
    const caret = inputRef.current?.selectionStart ?? current.length;
    set(`${current.slice(0, start)}@${s.username} ${current.slice(caret)}`);
    token.current = null;
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        type="text"
        name={name}
        className={className}
        value={current}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => {
          set(e.target.value);
          detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, -1));
          } else if (e.key === "Enter" && highlighted >= 0) {
            // Enter picks the highlighted climber rather than submitting the
            // form around it.
            e.preventDefault();
            apply(suggestions[highlighted]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
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
                  apply(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <span className="combobox-title">{s.display_name}</span>
                <span className="combobox-meta">@{s.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
