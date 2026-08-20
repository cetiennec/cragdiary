"use client";

import { useRef, useState } from "react";

/**
 * The levels themselves come from the labels: a day's three words are not a
 * profile's two (see `EntryVisibility` in lib/db), and each caller passes its
 * own set, listed openest first — which is the order they are offered in.
 */
export type VisibilityLabels = {
  picker: string;
  short: Record<string, string>;
};

// Small pill that changes one thing's visibility in place — an entry card's
// corner, or the profile header. The <select> submits its own form on change, so
// on a card it must sit outside the <Link> (an anchor can't contain a form
// control).
export default function VisibilityPicker({
  action,
  entryId,
  visibility,
  className = "",
  t,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Omitted for the profile picker — the action derives the user from the session. */
  entryId?: string;
  visibility: string;
  className?: string;
  t: VisibilityLabels;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Local echo so the pill's colour changes under the pointer, before the
  // server has answered.
  const [shown, setShown] = useState(visibility);

  return (
    <form ref={formRef} action={action} className={`visibility-picker ${className}`}>
      {entryId && <input type="hidden" name="id" value={entryId} />}
      {/* Uncontrolled, and keyed on what the server says. A controlled select
          inside a form the server re-renders came back showing the old value
          while the rest of the page showed the new one: the browser's own
          selection and React's state had drifted apart. Keyed, the answer
          replaces the control outright — and until it arrives the browser
          shows what was just picked, which is the same thing. */}
      <select
        key={visibility}
        name="visibility"
        defaultValue={visibility}
        aria-label={t.picker}
        title={t.picker}
        className={`visibility-select ${shown}`}
        onChange={(e) => {
          setShown(e.target.value);
          formRef.current?.requestSubmit();
        }}
      >
        {Object.entries(t.short).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </form>
  );
}
