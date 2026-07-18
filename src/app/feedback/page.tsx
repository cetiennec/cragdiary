import { getDict } from "@/lib/i18n";
import { sendFeedback } from "@/app/actions";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const [{ t }, { sent, error }] = await Promise.all([getDict(), searchParams]);

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.feedback.title}</h1>
      <p className="form-hint">{t.feedback.hint}</p>
      {sent && <p className="feedback-sent">{t.feedback.sent}</p>}
      {error && <p className="form-error">{t.feedback.error}</p>}
      <form action={sendFeedback} className="feedback-form">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <textarea
          name="message"
          rows={8}
          placeholder={t.feedback.messagePlaceholder}
          required
          maxLength={5000}
        />
        <input type="email" name="contact" placeholder={t.feedback.contactPlaceholder} />
        <button type="submit" className="btn-primary">
          {t.feedback.send}
        </button>
      </form>
    </div>
  );
}
