import Link from "next/link";
import { requestPasswordReset } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const [{ sent }, { t }] = await Promise.all([searchParams, getDict()]);

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.reset.forgotTitle}</h1>
      {sent ? (
        <p>{t.reset.sent}</p>
      ) : (
        <form action={requestPasswordReset} className="entry-form">
          <label>
            {t.reset.identifier}
            <input type="text" name="identifier" required autoFocus />
          </label>
          <p className="form-hint">{t.reset.identifierHint}</p>
          <button type="submit" className="btn-primary">
            {t.reset.submit}
          </button>
          <p className="form-hint">
            <Link href="/login">{t.login.title}</Link>
          </p>
        </form>
      )}
    </div>
  );
}
