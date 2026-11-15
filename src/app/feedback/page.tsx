import { getDict, titled } from "@/lib/i18n";
import FeedbackForm from "@/components/FeedbackForm";

export const generateMetadata = titled((t) => t.feedback.title);

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
      <FeedbackForm
        t={{
          messagePlaceholder: t.feedback.messagePlaceholder,
          contactPlaceholder: t.feedback.contactPlaceholder,
          send: t.feedback.send,
          sending: t.feedback.sending,
        }}
      />
    </div>
  );
}
