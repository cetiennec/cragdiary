"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createEntry, updateEntry } from "@/app/actions";
import type { Dict, Locale } from "@/lib/i18n";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { EntryWithAuthor } from "@/lib/queries";

type EditorDict = Dict["editor"];

const MAX_PITCH_SECTIONS = 40;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SubmitButton({ editing, t }: { editing: boolean; t: EditorDict }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? t.saving : editing ? t.saveChanges : t.save}
    </button>
  );
}

export default function EntryForm({
  entry,
  t,
  locale,
}: {
  entry?: EntryWithAuthor;
  t: EditorDict;
  locale: Locale;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const editing = Boolean(entry);

  const [title, setTitle] = useState(entry?.crag ?? "");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [grade, setGrade] = useState(entry?.grade_max ?? "");
  const [heightM, setHeightM] = useState(entry?.height_m ? String(entry.height_m) : "");
  const [c2cUrl, setC2cUrl] = useState(entry?.c2c_url ?? "");
  const [pitches, setPitches] = useState(entry?.pitches ? String(entry.pitches) : "");

  const [suggestions, setSuggestions] = useState<C2cSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const searchArmed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!searchArmed.current || title.trim().length < 3) {
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
        // aborted or network error — keep the editor silent and usable
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [title, locale]);

  function applySuggestion(s: C2cSuggestion) {
    searchArmed.current = false;
    setTitle(s.title);
    if (s.area) setLocation(s.area);
    if (s.height_m) setHeightM(String(s.height_m));
    if (s.grade) setGrade(s.grade);
    setC2cUrl(s.url);
    setSuggestions([]);
    setOpen(false);
  }

  function handleTitleKeys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      applySuggestion(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  }

  const pitchCount = Math.min(parseInt(pitches, 10) || 0, MAX_PITCH_SECTIONS);

  return (
    <form action={editing ? updateEntry : createEntry} className="notion-page notion-editor">
      <div className="notion-body">
        {editing && <input type="hidden" name="id" value={entry!.id} />}

        <div className="notion-icon" aria-hidden>
          🧗
        </div>

        <div className="combobox">
          <input
            type="text"
            name="crag"
            className="notion-title-input"
            placeholder={t.titlePlaceholder}
            aria-label={t.titleAria}
            value={title}
            onChange={(e) => {
              searchArmed.current = true;
              setTitle(e.target.value);
            }}
            onKeyDown={handleTitleKeys}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
            required
            autoFocus={!editing}
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
                      applySuggestion(s);
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
              <li className="combobox-attribution">{t.suggestionsAttribution}</li>
            </ul>
          )}
        </div>

        <div className="notion-props">
          <div className="notion-prop">
            <label htmlFor="entry_date">{t.date}</label>
            <input
              id="entry_date"
              type="date"
              name="entry_date"
              defaultValue={entry?.entry_date ?? today()}
              required
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="location">{t.location}</label>
            <input
              id="location"
              type="text"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t.locationPlaceholder}
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="style">{t.style}</label>
            <input
              id="style"
              type="text"
              name="style"
              list="style-options"
              defaultValue={entry?.style ?? ""}
              placeholder={t.stylePlaceholder}
            />
            <datalist id="style-options">
              {t.styleOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <div className="notion-prop">
            <label htmlFor="grade_max">{t.grade}</label>
            <input
              id="grade_max"
              type="text"
              name="grade_max"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder={t.gradePlaceholder}
            />
          </div>
          <div className="notion-prop notion-prop-pair">
            <label htmlFor="pitches">{t.pitches}</label>
            <div className="notion-prop-pair-fields">
              <input
                id="pitches"
                type="number"
                name="pitches"
                min={1}
                max={MAX_PITCH_SECTIONS}
                value={pitches}
                onChange={(e) => setPitches(e.target.value)}
                placeholder="4"
              />
              <label htmlFor="height_m" className="notion-prop-inline-label">
                {t.height}
              </label>
              <input
                id="height_m"
                type="number"
                name="height_m"
                min={1}
                value={heightM}
                onChange={(e) => setHeightM(e.target.value)}
                placeholder="150"
              />
            </div>
          </div>
          <div className="notion-prop">
            <label htmlFor="partners">{t.partners}</label>
            <input
              id="partners"
              type="text"
              name="partners"
              defaultValue={entry?.partners ?? ""}
              placeholder={t.partnersPlaceholder}
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="routes">{t.routes}</label>
            <input
              id="routes"
              type="text"
              name="routes"
              defaultValue={entry?.routes ?? ""}
              placeholder={t.routesPlaceholder}
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="c2c_url">{t.c2c}</label>
            <input
              id="c2c_url"
              type="url"
              name="c2c_url"
              value={c2cUrl}
              onChange={(e) => setC2cUrl(e.target.value)}
              placeholder={t.c2cPlaceholder}
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="visibility">{t.visibility}</label>
            <select id="visibility" name="visibility" defaultValue={entry?.visibility ?? "public"}>
              <option value="public">{t.visibilityOptions.public}</option>
              <option value="unlisted">{t.visibilityOptions.unlisted}</option>
              <option value="private">{t.visibilityOptions.private}</option>
            </select>
          </div>
          <div className="notion-prop">
            <label htmlFor="photos">{t.addPhotos}</label>
            <input
              id="photos"
              type="file"
              name="photos"
              accept="image/*"
              multiple
              onChange={handleFiles}
            />
          </div>
        </div>

        <hr className="notion-divider" />

        <textarea
          name="notes"
          className="notion-notes-input"
          rows={8}
          defaultValue={entry?.notes ?? ""}
          placeholder={t.notesPlaceholder}
          aria-label={t.notesAria}
        />

        {pitchCount > 0 && (
          <div className="pitch-notes">
            <p className="form-hint">{t.pitchNotesHint}</p>
            {Array.from({ length: pitchCount }, (_, i) => i + 1).map((n) => (
              <div key={n} className="pitch-note-row">
                <label htmlFor={`pitch_note_${n}`}>L{n}</label>
                <input
                  id={`pitch_note_${n}`}
                  type="text"
                  name={`pitch_note_${n}`}
                  defaultValue={entry?.pitch_notes?.[String(n)] ?? ""}
                  placeholder={t.pitchPlaceholder}
                />
              </div>
            ))}
          </div>
        )}

        {editing && entry!.photos.length > 0 && (
          <>
            <p className="form-hint">{t.currentPhotos}</p>
            <div className="photo-grid">
              {entry!.photos.map((photo) => (
                <label key={photo.id} className="photo-removable">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
                  <img src={`/api/photos/${photo.id}`} alt="" />
                  <span className="photo-remove-check">
                    <input type="checkbox" name="remove_photos" value={photo.id} /> {t.removePhoto}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {previews.length > 0 && (
          <div className="photo-grid notion-gallery">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}

        <div className="notion-editor-actions">
          <SubmitButton editing={editing} t={t} />
        </div>
      </div>
    </form>
  );
}
