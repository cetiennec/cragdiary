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
    <form className="entry-form" action={createEntry}>
      <label>
        Date
        <input type="date" name="entry_date" defaultValue={today()} required />
      </label>

      <label>
        Crag / location
        <input type="text" name="crag" placeholder="e.g. Céüse" required />
      </label>

      <label>
        Routes
        <input type="text" name="routes" placeholder="Berlin (7a), La Ravanelle..." />
      </label>

      <label>
        Partners
        <input type="text" name="partners" placeholder="Léo, Marine..." />
      </label>

      <label>
        Notes / vibe of the day
        <textarea
          name="notes"
          rows={6}
          placeholder="Perfect rock, hot approach, the light on the wall at sunset..."
        />
      </label>

      <label>
        Photos
        <input type="file" name="photos" accept="image/*" multiple onChange={handleFiles} />
      </label>

      {previews.length > 0 && (
        <div className="photo-grid">
          {previews.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt="" />
          ))}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}
