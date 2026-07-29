"use client";

import { useRef, useState } from "react";
import { setEntryVisibility } from "@/app/actions";
import type { Visibility } from "@/lib/db";

const ORDER: Visibility[] = ["public", "unlisted", "private"];

export type VisibilityLabels = {
  picker: string;
  short: Record<Visibility, string>;
};

// Small pill in the corner of an entry card: pick who can see that day without
// opening the edit form. The <select> submits its own form on change, so it must
// live outside the card's <Link> (an anchor can't contain form controls).
export default function EntryVisibilityPicker({
  entryId,
  visibility,
  t,
}: {
  entryId: string;
  visibility: Visibility;
  t: VisibilityLabels;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Local echo so the pill updates instantly, before the server round-trip.
  const [value, setValue] = useState<Visibility>(visibility);

  return (
    <form ref={formRef} action={setEntryVisibility} className="entry-visibility">
      <input type="hidden" name="id" value={entryId} />
      <select
        name="visibility"
        value={value}
        aria-label={t.picker}
        title={t.picker}
        className={`entry-visibility-select ${value}`}
        onChange={(e) => {
          setValue(e.target.value as Visibility);
          formRef.current?.requestSubmit();
        }}
      >
        {ORDER.map((v) => (
          <option key={v} value={v}>
            {t.short[v]}
          </option>
        ))}
      </select>
    </form>
  );
}
