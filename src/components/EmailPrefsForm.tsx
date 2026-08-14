"use client";

import { startTransition, useActionState } from "react";
import { sendDigestNow, updateEmailPrefs } from "@/app/actions";

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
    sendNow: string;
    sent: string;
    empty: string;
    throttled: string;
  };
}) {
  const [state, action, pending] = useActionState(updateEmailPrefs, { saved: false });
  // Its own action and its own answer: sending is not saving, and "nothing to
  // send this month" is a sentence the button has to be able to say.
  const [digestState, sendDigest, sending] = useActionState(
    () => sendDigestNow(),
    { status: null as null | "sent" | "empty" | "throttled" }
  );

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
      <span className="notif-email-send">
        <button type="button" className="seeker-locate" disabled={sending} formNoValidate
          onClick={() => startTransition(() => sendDigest())}>
          {sending ? "…" : labels.sendNow}
        </button>
        {digestState.status && !sending && (
          <span className="notif-email-saved">
            {digestState.status === "sent"
              ? `✓ ${labels.sent}`
              : digestState.status === "empty"
                ? labels.empty
                : labels.throttled}
          </span>
        )}
      </span>
    </form>
  );
}
