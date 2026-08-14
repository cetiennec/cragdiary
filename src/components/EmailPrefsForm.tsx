"use client";

import { useActionState } from "react";
import { updateEmailPrefs } from "@/app/actions";

/**
 * The two email switches, on the notifications page. A client component for
 * one reason: the panel has to stay open and say that it saved. As a plain
 * form it re-rendered the page, the `<details>` sprang shut, and the only
 * evidence anything had happened was in the database.
 */
export default function EmailPrefsForm({
  tags,
  digest,
  labels,
}: {
  tags: boolean;
  digest: boolean;
  labels: {
    tags: string;
    digest: string;
    to: string;
    save: string;
    saved: string;
  };
}) {
  const [state, action, pending] = useActionState(updateEmailPrefs, { saved: false });

  return (
    <form action={action} className="notif-email-form">
      <label>
        <input type="checkbox" name="email_tags" value="1" defaultChecked={tags} />
        {labels.tags}
      </label>
      <label>
        <input type="checkbox" name="email_digest" value="1" defaultChecked={digest} />
        {labels.digest}
      </label>
      <p className="form-hint">{labels.to}</p>
      <span className="notif-email-save">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "…" : labels.save}
        </button>
        {/* Stays put once shown: the panel is open, the answer should be
            readable for as long as someone looks at it. */}
        {state.saved && !pending && <span className="notif-email-saved">✓ {labels.saved}</span>}
      </span>
    </form>
  );
}
