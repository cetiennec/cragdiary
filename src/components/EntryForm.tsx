"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createEntry, updateEntry } from "@/app/actions";
import type { Dict } from "@/lib/i18n";
import type { EntryWithAuthor } from "@/lib/queries";

type EditorDict = Dict["editor"];

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
}: {
  entry?: EntryWithAuthor;
  t: EditorDict;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const editing = Boolean(entry);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  }

  return (
    <form action={editing ? updateEntry : createEntry} className="notion-page notion-editor">
      <div className="notion-body">
        {editing && <input type="hidden" name="id" value={entry!.id} />}

        <div className="notion-icon" aria-hidden>
          🧗
        </div>
        <input
          type="text"
          name="crag"
          className="notion-title-input"
          placeholder={t.titlePlaceholder}
          aria-label={t.titleAria}
          defaultValue={entry?.crag}
          required
          autoFocus={!editing}
        />

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
              defaultValue={entry?.location ?? ""}
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
              defaultValue={entry?.grade_max ?? ""}
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
                defaultValue={entry?.pitches ?? ""}
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
                defaultValue={entry?.height_m ?? ""}
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
          rows={10}
          defaultValue={entry?.notes ?? ""}
          placeholder={t.notesPlaceholder}
          aria-label={t.notesAria}
        />

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
