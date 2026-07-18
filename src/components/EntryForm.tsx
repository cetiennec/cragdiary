"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createEntry, updateEntry } from "@/app/actions";
import type { Dict, Locale } from "@/lib/i18n";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import type { UserSuggestion } from "@/app/api/users/search/route";
import type { EntryWithAuthor } from "@/lib/queries";
import { compressImage } from "@/lib/client-image";
import PhotoPlacement, { type PhotoLayoutValue } from "@/components/PhotoPlacement";

type EditorDict = Dict["editor"];

const MAX_PITCH_SECTIONS = 40;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SubmitButton({
  editing,
  blocked,
  t,
}: {
  editing: boolean;
  blocked: boolean;
  t: EditorDict;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending || blocked}>
      {pending ? t.saving : editing ? t.saveChanges : t.save}
    </button>
  );
}

export type EntryDefaults = {
  crag?: string;
  location?: string;
  grade_max?: string;
  rating?: string;
  pitches?: number | null;
  height_m?: number | null;
  c2c_url?: string;
  lat?: number | null;
  lon?: number | null;
  partners?: string;
  fromWish?: string;
};

export default function EntryForm({
  entry,
  defaults,
  t,
  locale,
}: {
  entry?: EntryWithAuthor;
  defaults?: EntryDefaults;
  t: EditorDict;
  locale: Locale;
}) {
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(entry);

  const [title, setTitle] = useState(entry?.crag ?? defaults?.crag ?? "");
  const [location, setLocation] = useState(entry?.location ?? defaults?.location ?? "");
  const [grade, setGrade] = useState(entry?.grade_max ?? defaults?.grade_max ?? "");
  const [rating, setRating] = useState(entry?.rating ?? defaults?.rating ?? "");
  const [orientation, setOrientation] = useState(entry?.orientation ?? "");
  const [equipment, setEquipment] = useState(entry?.equipment ?? "");
  const [heightM, setHeightM] = useState(
    entry?.height_m ? String(entry.height_m) : defaults?.height_m ? String(defaults.height_m) : ""
  );
  const [c2cUrl, setC2cUrl] = useState(entry?.c2c_url ?? defaults?.c2c_url ?? "");
  const [c2cSummary, setC2cSummary] = useState(entry?.c2c_summary ?? "");
  const [includeSummary, setIncludeSummary] = useState(Boolean(entry?.c2c_summary));
  const [pitches, setPitches] = useState(
    entry?.pitches ? String(entry.pitches) : defaults?.pitches ? String(defaults.pitches) : ""
  );

  const [starred, setStarred] = useState(entry?.starred ?? false);
  const [monthOnly, setMonthOnly] = useState(entry?.month_only ?? false);
  const [dateValue, setDateValue] = useState(
    entry?.entry_date
      ? entry.month_only
        ? entry.entry_date.slice(0, 7)
        : entry.entry_date
      : today()
  );
  const [lat, setLat] = useState(
    entry?.lat != null ? String(entry.lat) : defaults?.lat != null ? String(defaults.lat) : ""
  );
  const [lon, setLon] = useState(
    entry?.lon != null ? String(entry.lon) : defaults?.lon != null ? String(defaults.lon) : ""
  );

  const [excludedFields, setExcludedFields] = useState<Set<string>>(new Set());

  function toggleField(name: string) {
    setExcludedFields((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function fieldToggle(name: string) {
    const off = excludedFields.has(name);
    return (
      <button
        type="button"
        className="prop-toggle"
        aria-pressed={off}
        title={off ? t.autofillShow : t.autofillHide}
        onClick={() => toggleField(name)}
      >
        {off ? "🙈" : "👁"}
      </button>
    );
  }

  const [suggestions, setSuggestions] = useState<C2cSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const searchArmed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const [geoSuggestions, setGeoSuggestions] = useState<GeoSuggestion[]>([]);
  const [geoOpen, setGeoOpen] = useState(false);
  const [geoHighlighted, setGeoHighlighted] = useState(-1);
  const geoArmed = useRef(false);
  const geoAbortRef = useRef<AbortController | null>(null);

  const [partners, setPartners] = useState(entry?.partners ?? defaults?.partners ?? "");
  const [mentionSuggestions, setMentionSuggestions] = useState<UserSuggestion[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionHighlighted, setMentionHighlighted] = useState(-1);
  const mentionToken = useRef<{ start: number; text: string } | null>(null);
  const partnersInputRef = useRef<HTMLInputElement>(null);

  function detectMention(value: string, caret: number) {
    const upToCaret = value.slice(0, caret);
    const match = /@([a-z0-9-]*)$/i.exec(upToCaret);
    if (!match) {
      mentionToken.current = null;
      setMentionOpen(false);
      return;
    }
    mentionToken.current = { start: match.index, text: match[1] };
    if (match[1].length < 1) {
      setMentionOpen(false);
      return;
    }
    fetch(`/api/users/search?q=${encodeURIComponent(match[1])}`)
      .then((res) => res.json())
      .then((data: { results: UserSuggestion[] }) => {
        setMentionSuggestions(data.results);
        setMentionOpen(data.results.length > 0);
        setMentionHighlighted(-1);
      })
      .catch(() => {});
  }

  function applyMention(s: UserSuggestion) {
    const token = mentionToken.current;
    if (!token) return;
    const input = partnersInputRef.current;
    const caret = input?.selectionStart ?? partners.length;
    const next = `${partners.slice(0, token.start)}@${s.username} ${partners.slice(caret)}`;
    setPartners(next);
    mentionToken.current = null;
    setMentionOpen(false);
    setMentionSuggestions([]);
  }

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

  useEffect(() => {
    if (!geoArmed.current || location.trim().length < 3) {
      setGeoSuggestions([]);
      setGeoOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      geoAbortRef.current?.abort();
      const controller = new AbortController();
      geoAbortRef.current = controller;
      try {
        const res = await fetch(
          `/api/geo/search?q=${encodeURIComponent(location.trim())}&lang=${locale}`,
          { signal: controller.signal }
        );
        const data = (await res.json()) as { results: GeoSuggestion[] };
        setGeoSuggestions(data.results);
        setGeoOpen(data.results.length > 0);
        setGeoHighlighted(-1);
      } catch {
        // aborted or network error — keep the editor silent and usable
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [location, locale]);

  function applySuggestion(s: C2cSuggestion) {
    searchArmed.current = false;
    geoArmed.current = false;
    setTitle(s.title);
    if (s.area) setLocation(s.area);
    if (s.height_m) setHeightM(String(s.height_m));
    if (s.grade) setGrade(s.grade);
    if (s.rating) setRating(s.rating);
    if (s.orientation) setOrientation(s.orientation);
    if (s.equipment) setEquipment(s.equipment);
    if (s.summary) setC2cSummary(s.summary);
    setC2cUrl(s.url);
    if (s.lat != null && s.lon != null) {
      setLat(String(s.lat));
      setLon(String(s.lon));
    }
    setExcludedFields(new Set());
    setSuggestions([]);
    setOpen(false);
  }

  function applyGeoSuggestion(s: GeoSuggestion) {
    geoArmed.current = false;
    setLocation(s.name);
    setLat(String(s.lat));
    setLon(String(s.lon));
    setGeoSuggestions([]);
    setGeoOpen(false);
  }

  function comboKeys(
    e: React.KeyboardEvent<HTMLInputElement>,
    isOpen: boolean,
    count: number,
    idx: number,
    setIdx: (fn: (h: number) => number) => void,
    pick: () => void,
    close: () => void
  ) {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((h) => Math.min(h + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      pick();
    } else if (e.key === "Escape") {
      close();
    }
  }

  function syncFileInput(files: File[]) {
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    if (fileInputRef.current) fileInputRef.current.files = dt.files;
  }

  // Vercel rejects request bodies over ~4.5 MB, so the whole upload must fit
  // this budget; when the first pass is too big, recompress smaller.
  const UPLOAD_BUDGET = 3_500_000;
  const COMPRESSION_STEPS: [number, number][] = [
    [1800, 0.82],
    [1400, 0.78],
    [1100, 0.72],
    [900, 0.65],
  ];
  const [photoError, setPhotoError] = useState(false);

  const [newLayouts, setNewLayouts] = useState<PhotoLayoutValue[]>([]);

  function setNewLayout(index: number, patch: Partial<PhotoLayoutValue>) {
    setNewLayouts((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) {
      setNewFiles([]);
      setNewLayouts([]);
      setPhotoError(false);
      return;
    }
    let compressed: File[] = [];
    for (const [dim, quality] of COMPRESSION_STEPS) {
      compressed = await Promise.all(files.map((f) => compressImage(f, dim, quality)));
      const total = compressed.reduce((sum, f) => sum + f.size, 0);
      if (total <= UPLOAD_BUDGET) break;
    }
    const total = compressed.reduce((sum, f) => sum + f.size, 0);
    setPhotoError(total > UPLOAD_BUDGET);
    syncFileInput(compressed);
    setNewFiles(compressed);
    setNewLayouts(compressed.map(() => ({ align: "gallery", size: "m", para: "1" })));
  }

  function moveNewPhoto(index: number, delta: number) {
    const target = index + delta;
    setNewFiles((files) => {
      if (target < 0 || target >= files.length) return files;
      const next = [...files];
      [next[index], next[target]] = [next[target], next[index]];
      syncFileInput(next);
      return next;
    });
    setNewLayouts((layouts) => {
      if (target < 0 || target >= layouts.length) return layouts;
      const next = [...layouts];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const [orderedPhotos, setOrderedPhotos] = useState(entry?.photos ?? []);
  const [photoLayout, setPhotoLayout] = useState<
    Record<string, { align: string; size: string; para: string }>
  >(() =>
    Object.fromEntries(
      (entry?.photos ?? []).map((p) => [
        p.id,
        {
          align: p.align ?? "gallery",
          size: p.size ?? "m",
          para: p.para != null ? String(p.para + 1) : "1",
        },
      ])
    )
  );

  function setLayout(id: string, patch: Partial<{ align: string; size: string; para: string }>) {
    setPhotoLayout((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function movePhoto(index: number, delta: number) {
    setOrderedPhotos((photos) => {
      const target = index + delta;
      if (target < 0 || target >= photos.length) return photos;
      const next = [...photos];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const pitchCount = Math.min(parseInt(pitches, 10) || 0, MAX_PITCH_SECTIONS);

  return (
    <form action={editing ? updateEntry : createEntry} className="notion-page notion-editor">
      <div className="notion-body">
        {editing && <input type="hidden" name="id" value={entry!.id} />}
        {defaults?.fromWish && <input type="hidden" name="from_wish" value={defaults.fromWish} />}
        <input type="hidden" name="lat" value={excludedFields.has("location") ? "" : lat} />
        <input type="hidden" name="lon" value={excludedFields.has("location") ? "" : lon} />
        <input type="hidden" name="c2c_summary" value={includeSummary ? c2cSummary : ""} />

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
            onKeyDown={(e) =>
              comboKeys(
                e,
                open,
                suggestions.length,
                highlighted,
                setHighlighted,
                () => applySuggestion(suggestions[highlighted]),
                () => setOpen(false)
              )
            }
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
            <div className="notion-prop-pair-fields">
              <input
                id="entry_date"
                type={monthOnly ? "month" : "date"}
                name="entry_date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                required
              />
              <label className="notion-prop-inline-label date-precision-toggle">
                <input
                  type="checkbox"
                  checked={monthOnly}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setMonthOnly(next);
                    setDateValue((v) => (next ? v.slice(0, 7) : v.length === 7 ? `${v}-01` : v));
                  }}
                />{" "}
                {t.monthOnly}
              </label>
            </div>
          </div>
          <div className={`notion-prop${excludedFields.has("location") ? " prop-excluded" : ""}`}>
            <label htmlFor="location">{t.location}</label>
            <div className="prop-field">
            <div className="combobox">
              <input
                id="location"
                type="text"
                name="location"
                disabled={excludedFields.has("location")}
                value={location}
                onChange={(e) => {
                  geoArmed.current = true;
                  setLocation(e.target.value);
                  // Manually edited text no longer matches the picked point.
                  setLat("");
                  setLon("");
                }}
                onKeyDown={(e) =>
                  comboKeys(
                    e,
                    geoOpen,
                    geoSuggestions.length,
                    geoHighlighted,
                    setGeoHighlighted,
                    () => applyGeoSuggestion(geoSuggestions[geoHighlighted]),
                    () => setGeoOpen(false)
                  )
                }
                onBlur={() => setTimeout(() => setGeoOpen(false), 150)}
                autoComplete="off"
                placeholder={t.locationPlaceholder}
              />
              {geoOpen && (
                <ul className="combobox-list" role="listbox">
                  {geoSuggestions.map((s, i) => (
                    <li key={`${s.lat},${s.lon}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === geoHighlighted}
                        data-highlighted={i === geoHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyGeoSuggestion(s);
                        }}
                        onMouseEnter={() => setGeoHighlighted(i)}
                      >
                        <span className="combobox-title">{s.name}</span>
                        {s.region && <span className="combobox-meta">{s.region}</span>}
                      </button>
                    </li>
                  ))}
                  <li className="combobox-attribution">{t.geoAttribution}</li>
                </ul>
              )}
            </div>
            {fieldToggle("location")}
            </div>
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
          <div className={`notion-prop${excludedFields.has("grade_max") ? " prop-excluded" : ""}`}>
            <label htmlFor="grade_max">{t.grade}</label>
            <div className="prop-field">
              <input
                id="grade_max"
                type="text"
                name="grade_max"
                disabled={excludedFields.has("grade_max")}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder={t.gradePlaceholder}
              />
              {fieldToggle("grade_max")}
            </div>
          </div>
          <div className={`notion-prop${excludedFields.has("rating") ? " prop-excluded" : ""}`}>
            <label htmlFor="rating">{t.rating}</label>
            <div className="prop-field">
              <input
                id="rating"
                type="text"
                name="rating"
                list="rating-options"
                disabled={excludedFields.has("rating")}
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                placeholder={t.ratingPlaceholder}
              />
              {fieldToggle("rating")}
            </div>
            <datalist id="rating-options">
              {["F", "PD-", "PD", "PD+", "AD-", "AD", "AD+", "D-", "D", "D+", "TD-", "TD", "TD+", "ED-", "ED", "ED+", "ABO"].map(
                (option) => (
                  <option key={option} value={option} />
                )
              )}
            </datalist>
          </div>
          <div className="notion-prop">
            <label htmlFor="starred">{t.star}</label>
            <input type="hidden" name="starred" value={starred ? "1" : ""} />
            <button
              id="starred"
              type="button"
              className={`star-toggle${starred ? " on" : ""}`}
              aria-pressed={starred}
              title={t.starHint}
              onClick={() => setStarred(!starred)}
            >
              {starred ? "⭐" : "☆"}
            </button>
          </div>
          <div className={`notion-prop${excludedFields.has("orientation") ? " prop-excluded" : ""}`}>
            <label htmlFor="orientation">{t.orientation}</label>
            <div className="prop-field">
              <input
                id="orientation"
                type="text"
                name="orientation"
                list="orientation-options"
                disabled={excludedFields.has("orientation")}
                value={orientation}
                onChange={(e) => setOrientation(e.target.value)}
                placeholder={t.orientationPlaceholder}
              />
              {fieldToggle("orientation")}
            </div>
            <datalist id="orientation-options">
              {["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
          <div className={`notion-prop${excludedFields.has("equipment") ? " prop-excluded" : ""}`}>
            <label htmlFor="equipment">{t.equipment}</label>
            <div className="prop-field">
              <input
                id="equipment"
                type="text"
                name="equipment"
                list="equipment-options"
                disabled={excludedFields.has("equipment")}
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder={t.equipmentPlaceholder}
              />
              {fieldToggle("equipment")}
            </div>
            <datalist id="equipment-options">
              {["P1", "P1+", "P2", "P2+", "P3", "P3+", "P4", "P4+"].map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
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
                disabled={excludedFields.has("height_m")}
                className={excludedFields.has("height_m") ? "input-excluded" : undefined}
                value={heightM}
                onChange={(e) => setHeightM(e.target.value)}
                placeholder="150"
              />
              {fieldToggle("height_m")}
            </div>
          </div>
          <div className={`notion-prop${excludedFields.has("partners") ? " prop-excluded" : ""}`}>
            <label htmlFor="partners">{t.partners}</label>
            <div className="prop-field">
            <div className="combobox">
              <input
                id="partners"
                type="text"
                name="partners"
                ref={partnersInputRef}
                disabled={excludedFields.has("partners")}
                value={partners}
                onChange={(e) => {
                  setPartners(e.target.value);
                  detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyDown={(e) =>
                  comboKeys(
                    e,
                    mentionOpen,
                    mentionSuggestions.length,
                    mentionHighlighted,
                    setMentionHighlighted,
                    () => applyMention(mentionSuggestions[mentionHighlighted]),
                    () => setMentionOpen(false)
                  )
                }
                onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
                autoComplete="off"
                placeholder={t.partnersPlaceholder}
              />
              {mentionOpen && (
                <ul className="combobox-list" role="listbox">
                  {mentionSuggestions.map((s, i) => (
                    <li key={s.username}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === mentionHighlighted}
                        data-highlighted={i === mentionHighlighted}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMention(s);
                        }}
                        onMouseEnter={() => setMentionHighlighted(i)}
                      >
                        <span className="combobox-title">{s.display_name}</span>
                        <span className="combobox-meta">@{s.username}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {fieldToggle("partners")}
            </div>
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
          <div className={`notion-prop${excludedFields.has("c2c_url") ? " prop-excluded" : ""}`}>
            <label htmlFor="c2c_url">{t.c2c}</label>
            <div className="prop-field">
              <input
                id="c2c_url"
                type="url"
                name="c2c_url"
                disabled={excludedFields.has("c2c_url")}
                value={c2cUrl}
                onChange={(e) => setC2cUrl(e.target.value)}
                placeholder={t.c2cPlaceholder}
              />
              {fieldToggle("c2c_url")}
            </div>
          </div>
          <div className="notion-prop">
            <label htmlFor="show_pins">{t.showPins}</label>
            <label className="profile-public-toggle notion-checkbox">
              <input
                id="show_pins"
                type="checkbox"
                name="show_pins"
                value="1"
                defaultChecked={entry?.show_pins ?? true}
              />
            </label>
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
              ref={fileInputRef}
              onChange={handleFiles}
            />
          </div>
        </div>

        {c2cSummary && (
          <div className="c2c-summary-panel">
            <p className="c2c-summary-source">{t.c2cSummaryTitle}</p>
            <p className="c2c-summary-text">{c2cSummary}</p>
            <label className="c2c-summary-include">
              <input
                type="checkbox"
                checked={includeSummary}
                onChange={(e) => setIncludeSummary(e.target.checked)}
              />{" "}
              {t.c2cSummaryInclude}
            </label>
          </div>
        )}

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

        {editing && orderedPhotos.length > 0 && (
          <>
            <p className="form-hint">{t.currentPhotos}</p>
            <input
              type="hidden"
              name="photo_order"
              value={orderedPhotos.map((p) => p.id).join(",")}
            />
            <div className="photo-grid">
              {orderedPhotos.map((photo, i) => (
                <div key={photo.id} className="photo-removable">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
                  <img src={`/api/photos/${photo.id}`} alt="" />
                  <span className="photo-remove-check">
                    <button
                      type="button"
                      className="photo-move-btn"
                      aria-label={t.movePhotoEarlier}
                      disabled={i === 0}
                      onClick={() => movePhoto(i, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="photo-move-btn"
                      aria-label={t.movePhotoLater}
                      disabled={i === orderedPhotos.length - 1}
                      onClick={() => movePhoto(i, 1)}
                    >
                      →
                    </button>
                    <label>
                      <input type="checkbox" name="remove_photos" value={photo.id} />{" "}
                      {t.removePhoto}
                    </label>
                  </span>
                  <PhotoPlacement
                    value={photoLayout[photo.id] ?? { align: "gallery", size: "m", para: "1" }}
                    onChange={(patch) => setLayout(photo.id, patch)}
                    names={{
                      align: `photo_align_${photo.id}`,
                      size: `photo_size_${photo.id}`,
                      para: `photo_para_${photo.id}`,
                    }}
                    t={{
                      ...t.photoPlacementOptions,
                      size: t.photoSize,
                      para: t.photoPara,
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {newFiles.length > 0 && (
          <div className="photo-grid notion-gallery">
            {newFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="photo-removable">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={URL.createObjectURL(file)} alt="" />
                <span className="photo-remove-check">
                  <button
                    type="button"
                    className="photo-move-btn"
                    aria-label={t.movePhotoEarlier}
                    disabled={i === 0}
                    onClick={() => moveNewPhoto(i, -1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="photo-move-btn"
                    aria-label={t.movePhotoLater}
                    disabled={i === newFiles.length - 1}
                    onClick={() => moveNewPhoto(i, 1)}
                  >
                    →
                  </button>
                </span>
                <PhotoPlacement
                  value={newLayouts[i] ?? { align: "gallery", size: "m", para: "1" }}
                  onChange={(patch) => setNewLayout(i, patch)}
                  names={{
                    align: `new_photo_align_${i}`,
                    size: `new_photo_size_${i}`,
                    para: `new_photo_para_${i}`,
                  }}
                  t={{
                    ...t.photoPlacementOptions,
                    size: t.photoSize,
                    para: t.photoPara,
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {photoError && <p className="form-error">{t.tooManyPhotos}</p>}

        <div className="notion-editor-actions">
          <SubmitButton editing={editing} blocked={photoError} t={t} />
        </div>
      </div>
    </form>
  );
}
