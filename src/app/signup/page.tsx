import Link from "next/link";
import { signup } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { t }] = await Promise.all([searchParams, getDict()]);
  const errors = t.signup.errors as Record<string, string>;

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.signup.title}</h1>
      <form action={signup} className="entry-form">
        <label>
          {t.signup.username}
          <input
            type="text"
            name="username"
            required
            autoFocus
            autoComplete="username"
            pattern="[a-z0-9\-]{3,20}"
            placeholder={t.signup.usernameHint}
            // The browser's own "does not match the requested format" says
            // nothing about the format; `title` is what it shows underneath.
            title={t.signup.usernameRules}
          />
        </label>
        {/* Spelled out, and not only in the placeholder: a placeholder is gone
            the moment someone starts typing, which is exactly when the rule
            matters. */}
        <p className="form-hint">{t.signup.usernameRules}</p>
        <label>
          {t.signup.displayName}
          <input type="text" name="display_name" required placeholder={t.signup.displayNameHint} />
        </label>
        <label>
          {t.signup.email}
          <input type="email" name="email" autoComplete="email" placeholder={t.signup.emailHint} />
        </label>
        {/* Said plainly at the point of the choice: password recovery sends a
            link to this address and has no other route in, so an account
            without one cannot be recovered at all. */}
        <p className="form-hint">{t.signup.emailWarning}</p>
        <label>
          {t.signup.password}
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="form-error">{errors[error] ?? t.signup.errors.generic}</p>}
        {/* GDPR Art. 13 wants the notice where the data is collected, not
            merely somewhere on the site. */}
        <p className="form-hint">
          {t.signup.privacyPre}
          <Link href="/privacy">{t.signup.privacyLink}</Link>
          {t.signup.privacyPost}
        </p>
        <button type="submit" className="btn-primary">
          {t.signup.submit}
        </button>
        <p className="form-hint">
          {t.signup.hintPre}
          <Link href="/login">{t.signup.hintLink}</Link>.
        </p>
      </form>
    </div>
  );
}
