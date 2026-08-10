"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { addEntryPhoto, autosaveEntry, createEntry, updateEntry } from "@/app/actions";
import type { Dict, Locale } from "@/lib/i18n";
import type { C2cSuggestion } from "@/app/api/c2c/search/route";
import type { C2cOutingImport } from "@/lib/c2c";
import type { GeoSuggestion } from "@/app/api/geo/search/route";
import type { UserSuggestion } from "@/app/api/users/search/route";
import type { EntryWithAuthor } from "@/lib/queries";
import { compressImage, readPhotoDate } from "@/lib/client-image";
import PhotoTextPlacer, {
  type PhotoLayoutValue,
  type PlacerPhoto,
} from "@/components/PhotoTextPlacer";

const DEFAULT_LAYOUT: PhotoLayoutValue = { align: "gallery", size: "m", para: "1", caption: "" };

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
  c2cOuting?: string;
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

  const [starLevel, setStarLevel] = useState(entry?.star_level ?? 0);
  const [monthOnly, setMonthOnly] = useState(entry?.month_only ?? false);

  // Controlled notes: drives both the textarea and the "+" placement strip, so
  // programmatic fills (c2c outing import) show up and get submitted.
  const [notesText, setNotesText] = useState(entry?.notes ?? "");
  const paragraphs = notesText.trim() ? notesText.split(/\n{2,}/) : [];

  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved">("idle");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced field-only autosave while editing an existing entry. Photos are
  // excluded — they only upload on the explicit save.
  function queueAutosave() {
    if (!editing) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      const form = formRef.current;
      if (!form) return;
      const fd = new FormData(form);
      fd.delete("photos");
      fd.delete("remove_photos");
      setAutosave("saving");
      try {
        await autosaveEntry(fd);
        setAutosave("saved");
      } catch {
        setAutosave("idle");
      }
    }, 2500);
  }
  const [dateValue, setDateValue] = useState(
    entry?.entry_date
      ? entry.month_only
        ? entry.entry_date.slice(0, 7)
        : entry.entry_date
      : today()
  );
  // Once the user edits the date themselves, stop auto-deriving it from photos.
  const dateTouched = useRef(false);
  // Capture date read from an added photo's EXIF; a banner asks the user to
  // confirm it's the climb's date (checkbox on by default).
  const [photoDate, setPhotoDate] = useState<string | null>(null);
  const [usePhotoDate, setUsePhotoDate] = useState(true);

  function formatDate(d: string): string {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
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

  // Import a camptocamp outing (trip report) by link → prefill the whole
  // editor, including photos. Triggered from the "import a c2c outing" menu
  // (which asks for the link and opens /entries/new?c2c=…), auto-run on mount.
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [outingUrl, setOutingUrl] = useState("");
  const [imported, setImported] = useState(false);

  async function importOuting(rawUrl: string) {
    const url = rawUrl.trim();
    if (!url || importing) return;
    setImporting(true);
    setImportErr(null);
    try {
      const res = await fetch(
        `/api/c2c/outing?url=${encodeURIComponent(url)}&lang=${locale}`
      );
      if (!res.ok) throw new Error("import");
      const { outing } = (await res.json()) as { outing: C2cOutingImport };
      searchArmed.current = false;
      geoArmed.current = false;
      setTitle(outing.title);
      if (outing.location) setLocation(outing.location);
      if (outing.date) {
        dateTouched.current = true;
        setMonthOnly(false);
        setDateValue(outing.date);
        setUsePhotoDate(false);
      }
      if (outing.grade) setGrade(outing.grade);
      if (outing.rating) setRating(outing.rating);
      if (outing.orientation) setOrientation(outing.orientation);
      if (outing.equipment) setEquipment(outing.equipment);
      if (outing.height_m) setHeightM(String(outing.height_m));
      if (outing.lat != null && outing.lon != null) {
        setLat(String(outing.lat));
        setLon(String(outing.lon));
      }
      if (outing.c2c_url) setC2cUrl(outing.c2c_url);
      if (outing.c2c_summary) {
        setC2cSummary(outing.c2c_summary);
        setIncludeSummary(true);
      }
      if (outing.notes) setNotesText(outing.notes);
      if (outing.partners) setPartners(outing.partners);
      setExcludedFields(new Set());
      setSuggestions([]);
      setOpen(false);
      setGeoSuggestions([]);
      setGeoOpen(false);

      // Pull the outing's photos in via the proxy, then run them through the
      // normal client compression + append pipeline.
      const filenames = outing.images.slice(0, 20);
      if (filenames.length > 0) {
        const fetched = await Promise.all(
          filenames.map(async (fn, i) => {
            try {
              const r = await fetch(
                `/api/c2c/image?f=${encodeURIComponent(fn)}&size=BI`
              );
              if (!r.ok) return null;
              const blob = await r.blob();
              return new File([blob], `c2c-${i + 1}.jpg`, {
                type: blob.type || "image/jpeg",
              });
            } catch {
              return null;
            }
          })
        );
        const files = fetched.filter((f): f is File => f !== null);
        if (files.length > 0) await ingestFiles(files, "append");
      }
      setImported(true);
      setOutingUrl("");
    } catch {
      setImportErr(t.c2cImportError);
    } finally {
      setImporting(false);
    }
  }

  // Auto-import when the editor is opened from "import a c2c outing". Deferred
  // a tick: the import sets state as it goes, and doing that from an effect
  // body cascades renders before the editor has painted once.
  const c2cOuting = defaults?.c2cOuting;
  useEffect(() => {
    if (editing || !c2cOuting) return;
    const id = setTimeout(() => void importOuting(c2cOuting), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Compress on the client straight to the final target (≈2048 px, good WebP
  // quality) so the upload is small — ~0.5 MB instead of several MB. Small,
  // fast uploads are far less likely to be cut off on flaky mobile networks or
  // when iOS suspends the PWA, which is the main cause of failed uploads. The
  // server re-encodes at the same size/quality, so the visible result matches.
  const PER_PHOTO_BUDGET = 1_500_000;
  const COMPRESSION_STEPS: [number, number][] = [
    [2048, 0.86],
    [1800, 0.82],
    [1500, 0.78],
    [1200, 0.72],
  ];
  const [photoError, setPhotoError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  // Real failure detail — uploads fail client-side/at the edge and never reach
  // the server logs, so surface the message to make the cause diagnosable.
  const [submitErrorDetail, setSubmitErrorDetail] = useState<string | null>(null);

  const [newLayouts, setNewLayouts] = useState<PhotoLayoutValue[]>([]);

  function setNewLayout(index: number, patch: Partial<PhotoLayoutValue>) {
    setNewLayouts((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Uploads photos a few at a time (each request stays under Vercel's body cap)
  // with an explicit position so concurrent uploads keep their chosen order, and
  // a couple of retries so one flaky request on mobile doesn't fail the batch.
  const UPLOAD_CONCURRENCY = 3;
  const UPLOAD_RETRIES = 3;
  const UPLOAD_BACKOFF_MS = [600, 1500, 3000];

  async function uploadOne(entryId: string, index: number, position: number) {
    const layout = newLayouts[index];
    for (let attempt = 0; ; attempt++) {
      try {
        const pfd = new FormData();
        pfd.append("id", entryId);
        pfd.append("photo", newFiles[index]);
        pfd.append("position", String(position));
        pfd.append("new_photo_align_0", layout.align === "gallery" ? "" : layout.align);
        pfd.append("new_photo_size_0", layout.size);
        pfd.append("new_photo_para_0", layout.para);
        pfd.append("new_photo_caption_0", layout.caption);
        await addEntryPhoto(pfd);
        return;
      } catch (err) {
        if (attempt >= UPLOAD_RETRIES) throw err;
        await new Promise((r) =>
          setTimeout(r, UPLOAD_BACKOFF_MS[Math.min(attempt, UPLOAD_BACKOFF_MS.length - 1)])
        );
      }
    }
  }

  async function uploadPhotos(entryId: string, basePosition: number) {
    let done = 0;
    let next = 0;
    setUploadProgress(`0/${newFiles.length}`);
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= newFiles.length) return;
        await uploadOne(entryId, i, basePosition + i);
        done += 1;
        setUploadProgress(`${done}/${newFiles.length}`);
      }
    }
    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, newFiles.length) },
      worker
    );
    await Promise.all(workers);
  }

  // Shared by the file picker (replace) and drag-and-drop import (append):
  // derive the entry date from EXIF, compress, then set/extend the pending
  // photos and their layouts.
  async function ingestFiles(files: File[], mode: "replace" | "append") {
    if (files.length === 0) {
      if (mode === "replace") {
        setNewFiles([]);
        setNewLayouts([]);
        setPhotoError(false);
      }
      return;
    }
    // Derive the entry date from the photos' capture date (oldest first) when
    // creating an entry and the user hasn't set the date themselves. Read from
    // the originals — compression below strips EXIF.
    if (!editing && !dateTouched.current) {
      const dates = (await Promise.all(files.map((f) => readPhotoDate(f)))).filter(
        (d): d is string => Boolean(d)
      );
      if (dates.length > 0) {
        dates.sort();
        setPhotoDate(dates[0]);
        setUsePhotoDate(true);
        setDateValue(monthOnly ? dates[0].slice(0, 7) : dates[0]);
      }
    }
    const compressed = await Promise.all(
      files.map(async (f) => {
        let out = f;
        for (const [dim, quality] of COMPRESSION_STEPS) {
          out = await compressImage(f, dim, quality);
          if (out.size <= PER_PHOTO_BUDGET) break;
        }
        return out;
      })
    );
    setNewFiles((prev) => {
      const next = mode === "append" ? [...prev, ...compressed] : compressed;
      syncFileInput(next);
      setPhotoError(next.some((f) => f.size > PER_PHOTO_BUDGET));
      return next;
    });
    setNewLayouts((prev) => {
      const added = compressed.map(() => ({
        align: "gallery",
        size: "m",
        para: "1",
        caption: "",
      }));
      return mode === "append" ? [...prev, ...added] : added;
    });
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    await ingestFiles(Array.from(e.target.files ?? []), "replace");
  }

  // Drag an image file from the desktop anywhere on the page to import it.
  // Window-level listeners so the whole page is a dropzone (and the browser
  // doesn't just open the dropped file). ingestFiles is kept fresh via a ref.
  const [dropActive, setDropActive] = useState(false);
  const ingestRef = useRef(ingestFiles);
  useEffect(() => {
    ingestRef.current = ingestFiles;
  });

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDropActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDropActive(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropActive(false);
      const images = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (images.length > 0) void ingestRef.current(images, "append");
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

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

  function removeNewPhoto(index: number) {
    setNewFiles((files) => {
      const next = files.filter((_, i) => i !== index);
      syncFileInput(next);
      setPhotoError(next.some((f) => f.size > PER_PHOTO_BUDGET));
      return next;
    });
    setNewLayouts((layouts) => layouts.filter((_, i) => i !== index));
  }

  const [orderedPhotos, setOrderedPhotos] = useState(entry?.photos ?? []);
  const [removedPhotos, setRemovedPhotos] = useState<Set<string>>(new Set());

  function toggleRemovePhoto(id: string) {
    setRemovedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [photoLayout, setPhotoLayout] = useState<Record<string, PhotoLayoutValue>>(() =>
    Object.fromEntries(
      (entry?.photos ?? []).map((p) => [
        p.id,
        {
          align: p.align ?? "gallery",
          size: p.size ?? "m",
          para: p.para != null ? String(p.para + 1) : "1",
          caption: p.caption ?? "",
        },
      ])
    )
  );

  function setLayout(id: string, patch: Partial<PhotoLayoutValue>) {
    setPhotoLayout((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // Stable object URLs for the not-yet-uploaded files, revoked on change so we
  // don't leak a new blob URL on every keystroke-triggered re-render.
  const newFileUrls = useMemo(
    () => newFiles.map((f) => URL.createObjectURL(f)),
    [newFiles]
  );
  useEffect(
    () => () => newFileUrls.forEach((u) => URL.revokeObjectURL(u)),
    [newFileUrls]
  );

  // Photo layouts live in two stores (saved photos by id, new files by index);
  // these route a change to the right one from a single "key".
  function layoutFor(key: string): PhotoLayoutValue {
    if (key.startsWith("new-")) return newLayouts[Number(key.slice(4))] ?? DEFAULT_LAYOUT;
    return photoLayout[key] ?? DEFAULT_LAYOUT;
  }
  function setLayoutFor(key: string, patch: Partial<PhotoLayoutValue>) {
    if (key.startsWith("new-")) setNewLayout(Number(key.slice(4)), patch);
    else setLayout(key, patch);
  }

  const paraCount = paragraphs.length;
  const clampPara = (n: number) => Math.min(Math.max(n || 1, 1), paraCount + 1);

  // Placing a gallery photo into the text defaults it to full width; an
  // already-inline photo keeps its side/size and just moves.
  function placeInText(key: string, para: number) {
    const cur = layoutFor(key);
    setLayoutFor(key, {
      para: String(para),
      align: cur.align === "gallery" ? "full" : cur.align,
    });
  }
  function removeFromText(key: string) {
    setLayoutFor(key, { align: "gallery" });
  }

  const placerPhotos: PlacerPhoto[] = [
    ...orderedPhotos
      .filter((p) => !removedPhotos.has(p.id))
      .map((p) => {
        const l = photoLayout[p.id] ?? DEFAULT_LAYOUT;
        return {
          key: p.id,
          src: `/api/photos/${p.id}`,
          para: clampPara(Number(l.para)),
          align: l.align ?? "gallery",
          size: l.size ?? "m",
        };
      }),
    ...newFiles.map((_, i) => {
      const l = newLayouts[i] ?? DEFAULT_LAYOUT;
      return {
        key: `new-${i}`,
        src: newFileUrls[i],
        para: clampPara(Number(l.para)),
        align: l.align ?? "gallery",
        size: l.size ?? "m",
      };
    }),
  ];

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
    <form
      ref={formRef}
      action={
        editing
          ? updateEntry
          : async (fd: FormData) => {
              await createEntry(fd); // redirects server-side; string return is only for the photo path
            }
      }
      onInput={queueAutosave}
      onSubmit={(e) => {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        if (newFiles.length === 0) return; // no photos: plain server-action submit
        // Photos go up one request at a time, so any number of them fits
        // under Vercel's body cap; then navigate to the saved entry.
        e.preventDefault();
        if (submitting) return;
        const form = formRef.current;
        if (!form || !form.reportValidity()) return;
        (async () => {
          setSubmitting(true);
          setSubmitError(false);
          setSubmitErrorDetail(null);
          try {
            const fd = new FormData(form);
            fd.delete("photos");
            fd.append("no_redirect", "1");
            const savedId = editing
              ? (await updateEntry(fd), entry!.id)
              : ((await createEntry(fd)) as string);
            // New photos land after any existing ones (updateEntry has already
            // renumbered kept photos to 0..length-1).
            const basePosition = editing ? orderedPhotos.length : 0;
            await uploadPhotos(savedId, basePosition);
            router.push(`/entries/${savedId}`);
          } catch (err) {
            setSubmitError(true);
            setSubmitErrorDetail(err instanceof Error ? err.message : String(err));
            setSubmitting(false);
            setUploadProgress(null);
          }
        })();
      }}
      className="notion-page notion-editor"
    >
      {dropActive && (
        <div className="editor-dropzone" aria-hidden>
          <span>
            <span className="editor-dropzone-plus">+</span>
            {t.dropToImport}
          </span>
        </div>
      )}
      <div className="notion-body">
        {editing && <input type="hidden" name="id" value={entry!.id} />}
        {defaults?.fromWish && <input type="hidden" name="from_wish" value={defaults.fromWish} />}
        <input type="hidden" name="lat" value={excludedFields.has("location") ? "" : lat} />
        <input type="hidden" name="lon" value={excludedFields.has("location") ? "" : lon} />
        <input type="hidden" name="c2c_summary" value={includeSummary ? c2cSummary : ""} />

        <div className="editor-head-row">
          <div className="notion-icon" aria-hidden>
            🧗
          </div>
          <div className="editor-star-row">
            {editing && autosave !== "idle" && (
              <span className="autosave-status">
                {autosave === "saving" ? t.autosaving : t.autosaved}
              </span>
            )}
            {starLevel > 0 && (
              <span className="star-level-label">{t.starLevels[starLevel - 1]}</span>
            )}
            {starLevel < 0 && (
              <span className="star-level-label">{t.notRecommended}</span>
            )}
            <input type="hidden" name="star_level" value={String(starLevel)} />
            <span className="star-rack" title={t.starHint}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`star-toggle${starLevel >= n ? " on" : ""}`}
                  aria-pressed={starLevel >= n}
                  aria-label={t.starLevels[n - 1]}
                  onClick={() => {
                    setStarLevel(starLevel === n ? 0 : n);
                    queueAutosave();
                  }}
                >
                  {starLevel >= n ? "⭐" : "☆"}
                </button>
              ))}
              <button
                type="button"
                className={`star-toggle dislike-toggle${starLevel < 0 ? " on" : ""}`}
                aria-pressed={starLevel < 0}
                aria-label={t.notRecommended}
                title={t.notRecommended}
                onClick={() => {
                  setStarLevel(starLevel < 0 ? 0 : -1);
                  queueAutosave();
                }}
              >
                👎
              </button>
            </span>
          </div>
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

        {!editing && (
          <div className="c2c-inline">
            <input
              type="url"
              inputMode="url"
              className="c2c-inline-input"
              placeholder={`🏔️ ${t.c2cInlinePlaceholder}`}
              value={outingUrl}
              disabled={importing}
              onChange={(e) => setOutingUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void importOuting(outingUrl);
                }
              }}
              onBlur={() => {
                if (outingUrl.trim()) void importOuting(outingUrl);
              }}
            />
            {importing && <span className="c2c-inline-status">⏳ {t.c2cImporting}</span>}
            {importErr && <span className="form-error">{importErr}</span>}
            {!importing && !importErr && (outingUrl.trim() || imported) && (
              <span className="c2c-inline-note">⚠️ {t.c2cImportWarning}</span>
            )}
          </div>
        )}

        <div className="notion-props">
          <div className="notion-prop">
            <label htmlFor="entry_date">{t.date}</label>
            <div className="notion-prop-pair-fields">
              <input
                id="entry_date"
                type={monthOnly ? "month" : "date"}
                name="entry_date"
                value={dateValue}
                onChange={(e) => {
                  dateTouched.current = true;
                  setPhotoDate(null);
                  setDateValue(e.target.value);
                }}
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
            {!editing && photoDate && usePhotoDate && (
              <p className="date-photo-note">{t.dateFromPhotoNote}</p>
            )}
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
                  // Typing a different place name no longer matches the picked
                  // point, so drop the pin. But clearing the name to blank
                  // keeps the pin — you can drop the label without moving the
                  // map (e.g. after a c2c import).
                  if (e.target.value.trim() !== "") {
                    setLat("");
                    setLon("");
                  }
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
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          placeholder={t.notesPlaceholder}
          aria-label={t.notesAria}
        />

        {placerPhotos.length > 0 && (
          <PhotoTextPlacer
            paragraphs={paragraphs}
            photos={placerPhotos}
            onPlace={placeInText}
            onUnplace={removeFromText}
            onAdjust={setLayoutFor}
            t={{
              ...t.photoPlacer,
              left: t.photoPlacementOptions.left,
              right: t.photoPlacementOptions.right,
              full: t.photoPlacementOptions.full,
              size: t.photoSize,
            }}
          />
        )}

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
              {orderedPhotos.map((photo, i) => {
                const removed = removedPhotos.has(photo.id);
                return (
                  <div
                    key={photo.id}
                    className={`photo-removable${removed ? " photo-removed" : ""}`}
                  >
                    {removed && (
                      <input type="hidden" name="remove_photos" value={photo.id} />
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
                    <img src={`/api/photos/${photo.id}`} alt="" />
                    <button
                      type="button"
                      className="photo-remove-x"
                      aria-label={removed ? t.undoRemovePhoto : t.removePhoto}
                      title={removed ? t.undoRemovePhoto : t.removePhoto}
                      onClick={() => toggleRemovePhoto(photo.id)}
                    >
                      {removed ? "↺" : "×"}
                    </button>
                    {!removed && (
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
                      </span>
                    )}
                    {!removed && (
                      <>
                        <input
                          type="text"
                          className="photo-caption-input"
                          name={`photo_caption_${photo.id}`}
                          value={photoLayout[photo.id]?.caption ?? ""}
                          onChange={(e) => setLayout(photo.id, { caption: e.target.value })}
                          placeholder={t.photoCaption}
                          maxLength={200}
                        />
                        <input
                          type="hidden"
                          name={`photo_align_${photo.id}`}
                          value={photoLayout[photo.id]?.align ?? "gallery"}
                        />
                        <input
                          type="hidden"
                          name={`photo_size_${photo.id}`}
                          value={photoLayout[photo.id]?.size ?? "m"}
                        />
                        <input
                          type="hidden"
                          name={`photo_para_${photo.id}`}
                          value={photoLayout[photo.id]?.para ?? "1"}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {newFiles.length > 0 && (
          <div className="photo-grid notion-gallery">
            {newFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="photo-removable">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={newFileUrls[i]} alt="" />
                <button
                  type="button"
                  className="photo-remove-x"
                  aria-label={t.removePhoto}
                  title={t.removePhoto}
                  onClick={() => removeNewPhoto(i)}
                >
                  ×
                </button>
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
                <input
                  type="text"
                  className="photo-caption-input"
                  value={newLayouts[i]?.caption ?? ""}
                  onChange={(e) => setNewLayout(i, { caption: e.target.value })}
                  placeholder={t.photoCaption}
                  maxLength={200}
                />
                <input
                  type="hidden"
                  name={`new_photo_align_${i}`}
                  value={newLayouts[i]?.align ?? "gallery"}
                />
                <input
                  type="hidden"
                  name={`new_photo_size_${i}`}
                  value={newLayouts[i]?.size ?? "m"}
                />
                <input
                  type="hidden"
                  name={`new_photo_para_${i}`}
                  value={newLayouts[i]?.para ?? "1"}
                />
              </div>
            ))}
          </div>
        )}

        {!editing && photoDate && (
          <label className="date-photo-banner">
            <input
              type="checkbox"
              checked={usePhotoDate}
              onChange={(e) => {
                const next = e.target.checked;
                setUsePhotoDate(next);
                const base = next ? photoDate : today();
                setDateValue(monthOnly ? base.slice(0, 7) : base);
              }}
            />
            <span>
              📅 {t.dateFromPhotoQuestion} <strong>{formatDate(photoDate)}</strong>
            </span>
          </label>
        )}

        {photoError && <p className="form-error">{t.tooManyPhotos}</p>}
        {submitError && (
          <p className="form-error">
            {t.uploadFailed}
            {submitErrorDetail && (
              <>
                <br />
                <span className="form-error-detail">{submitErrorDetail}</span>
              </>
            )}
          </p>
        )}

        <div className="notion-editor-actions">
          {submitting && (
            <span className="autosave-status">
              {t.uploadingPhotos}
              {uploadProgress ? ` ${uploadProgress}` : ""}
            </span>
          )}
          <SubmitButton editing={editing} blocked={photoError || submitting} t={t} />
        </div>
      </div>
    </form>
  );
}
