"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createEntry, updateEntry } from "@/app/actions";
import type { EntryWithAuthor } from "@/lib/queries";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : editing ? "Save changes" : "Save entry"}
    </button>
  );
}

export default function EntryForm({ entry }: { entry?: EntryWithAuthor }) {
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
          placeholder="Untitled crag…"
          aria-label="Crag / location"
          defaultValue={entry?.crag}
          required
          autoFocus={!editing}
        />

        <div className="notion-props">
          <div className="notion-prop">
            <label htmlFor="entry_date">📅 Date</label>
            <input
              id="entry_date"
              type="date"
              name="entry_date"
              defaultValue={entry?.entry_date ?? today()}
              required
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="routes">🧭 Routes</label>
            <input
              id="routes"
              type="text"
              name="routes"
              defaultValue={entry?.routes ?? ""}
              placeholder="Berlin (7a), La Ravanelle…"
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="partners">👥 Partners</label>
            <input
              id="partners"
              type="text"
              name="partners"
              defaultValue={entry?.partners ?? ""}
              placeholder="Léo, Marine…"
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="visibility">👁️ Visibility</label>
            <select id="visibility" name="visibility" defaultValue={entry?.visibility ?? "public"}>
              <option value="public">🌍 Public — on the main feed</option>
              <option value="unlisted">🔗 Link only — anyone with the link</option>
              <option value="private">🔒 Private — just you</option>
            </select>
          </div>
          <div className="notion-prop">
            <label htmlFor="photos">🖼️ Add photos</label>
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
          placeholder="Write about the day — the rock, the light, the people, the vibe…"
          aria-label="Notes"
        />

        {editing && entry!.photos.length > 0 && (
          <>
            <p className="form-hint">Current photos — tick to remove on save:</p>
            <div className="photo-grid">
              {entry!.photos.map((photo) => (
                <label key={photo.id} className="photo-removable">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from our own DB-backed route, already resized/compressed server-side */}
                  <img src={`/api/photos/${photo.id}`} alt="" />
                  <span className="photo-remove-check">
                    <input type="checkbox" name="remove_photos" value={photo.id} /> Remove
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
          <SubmitButton editing={editing} />
        </div>
      </div>
    </form>
  );
}
