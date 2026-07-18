"use client";

import { useFormStatus } from "react-dom";
import { sendFeedback } from "@/app/actions";

function SendButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

// Client wrapper so the send button shows a pending state — the email hop can
// take a few seconds and a silent form reads as frozen.
export default function FeedbackForm({
  t,
}: {
  t: {
    messagePlaceholder: string;
    contactPlaceholder: string;
    send: string;
    sending: string;
  };
}) {
  return (
    <form action={sendFeedback} className="feedback-form">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <textarea
        name="message"
        rows={8}
        placeholder={t.messagePlaceholder}
        required
        maxLength={5000}
      />
      <input type="email" name="contact" placeholder={t.contactPlaceholder} />
      <SendButton label={t.send} pendingLabel={t.sending} />
    </form>
  );
}
