"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createEntry } from "@/app/actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save entry"}
    </button>
  );
}

export default function EntryForm() {
  const [previews, setPreviews] = useState<string[]>([]);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  }

  return (
    <form action={createEntry} className="notion-page notion-editor">
      <div className="notion-body">
        <div className="notion-icon" aria-hidden>
          🧗
        </div>
        <input
          type="text"
          name="crag"
          className="notion-title-input"
          placeholder="Untitled crag…"
          aria-label="Crag / location"
          required
          autoFocus
        />

        <div className="notion-props">
          <div className="notion-prop">
            <label htmlFor="entry_date">📅 Date</label>
            <input id="entry_date" type="date" name="entry_date" defaultValue={today()} required />
          </div>
          <div className="notion-prop">
            <label htmlFor="routes">🧭 Routes</label>
            <input
              id="routes"
              type="text"
              name="routes"
              placeholder="Berlin (7a), La Ravanelle…"
            />
          </div>
          <div className="notion-prop">
            <label htmlFor="partners">👥 Partners</label>
            <input id="partners" type="text" name="partners" placeholder="Léo, Marine…" />
          </div>
          <div className="notion-prop">
            <label htmlFor="photos">🖼️ Photos</label>
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
          placeholder="Write about the day — the rock, the light, the people, the vibe…"
          aria-label="Notes"
        />

        {previews.length > 0 && (
          <div className="photo-grid notion-gallery">
            {previews.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}

        <div className="notion-editor-actions">
          <SubmitButton />
        </div>
      </div>
    </form>
  );
}
