import Link from "next/link";
import { signup } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [{ error, next }, { t }] = await Promise.all([searchParams, getDict()]);
  // Only our own paths travel: the action refuses anything else, and echoing a
  // stranger's URL back into the page would be half an open redirect already.
  const back = next?.startsWith("/") && !next.startsWith("//") ? next : null;
  const errors = t.signup.errors as Record<string, string>;

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.signup.title}</h1>
      <form action={signup} className="entry-form">
        {back && <input type="hidden" name="next" value={back} />}
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
        {/* Only once the browser says the name is wrong — the rules are noise
            to everyone who types a plain name, and the answer to the question
            for the one who doesn't. `title` puts the same words in the
            browser's own bubble. */}
        <p className="form-hint form-rule">{t.signup.usernameRules}</p>
        <label>
          {t.signup.displayName}
          <input type="text" name="display_name" required placeholder={t.signup.displayNameHint} />
        </label>
        <label>
          {t.signup.email}
          <input type="email" name="email" autoComplete="email" placeholder={t.signup.emailHint} />
        </label>
        {/* Said at the point of the choice, and only while the box is still
            empty: what the address is for. */}
        <div className="form-hint form-warn">
          <p>{t.signup.emailUses}</p>
          <ul>
            <li>{t.signup.emailUseReset}</li>
            <li>{t.signup.emailUseDigest}</li>
          </ul>
        </div>
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
          <Link href={back ? `/login?next=${encodeURIComponent(back)}` : "/login"}>
            {t.signup.hintLink}
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
