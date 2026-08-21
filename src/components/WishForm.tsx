"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import MentionInput from "@/components/MentionInput";
import { addWish } from "@/app/actions";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { Locale } from "@/lib/i18n";

export type WishFormLabels = {
  titlePlaceholder: string;
  notePlaceholder: string;
  partnersPlaceholder: string;
  add: string;
  attribution: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export default function WishForm({
  t,
  locale,
  wishlistId,
  withPartners = true,
}: {
  t: WishFormLabels;
  locale: Locale;
  wishlistId: string;
  /** False on a shared list — see WishlistSection. */
  withPartners?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState({
    location: "",
    grade_max: "",
    rating: "",
    pitches: "",
    height_m: "",
    c2c_url: "",
    lat: "",
    lon: "",
  });
  const [suggestions, setSuggestions] = useState<C2cSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const armed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!armed.current || title.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/c2c/search?q=${encodeURIComponent(title.trim())}&lang=${locale}`,
          { signal: controller.signal }
        );
        const data = (await res.json()) as { results: C2cSuggestion[] };
        setSuggestions(data.results);
        setOpen(data.results.length > 0);
        setHighlighted(-1);
      } catch {
        // silent
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [title, locale]);

  function apply(s: C2cSuggestion) {
    armed.current = false;
    setTitle(s.title);
    setFields({
      location: s.area ?? "",
      grade_max: s.grade ?? "",
      rating: s.rating ?? "",
      pitches: "",
      height_m: s.height_m ? String(s.height_m) : "",
      c2c_url: s.url,
      lat: s.lat != null ? String(s.lat) : "",
      lon: s.lon != null ? String(s.lon) : "",
    });
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <form action={addWish} className="wish-form">
      <input type="hidden" name="wishlist_id" value={wishlistId} />
      {Object.entries(fields).map(([name, value]) =>
        name === "location" || name === "note" ? null : (
          <input key={name} type="hidden" name={name} value={value} />
        )
      )}
      <input type="hidden" name="location" value={fields.location} />
      <div className="combobox wish-title">
        <input
          type="text"
          name="title"
          value={title}
          onChange={(e) => {
            armed.current = true;
            setTitle(e.target.value);
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
              e.preventDefault();
              apply(suggestions[highlighted]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
          placeholder={t.titlePlaceholder}
          required
        />
        {open && (
          <ul className="combobox-list" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.id}>
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
                  <span className="combobox-title">{s.title}</span>
                  <span className="combobox-meta">
                    {[s.area, s.height_m ? `${s.height_m} m` : null, s.rating, s.grade]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            <li className="combobox-attribution">{t.attribution}</li>
          </ul>
        )}
      </div>
      <input type="text" name="note" placeholder={t.notePlaceholder} className="wish-note" />
      {/* Absent on a shared list, where the people it is shared with are the
          partners already — the same reasoning as the per-route field. */}
      {withPartners && (
        <MentionInput
          name="partners"
          placeholder={t.partnersPlaceholder}
          className="wish-note"
        />
      )}
      <SubmitButton label={t.add} />
    </form>
  );
}
