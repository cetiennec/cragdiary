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
          />
        </label>
        <label>
          {t.signup.displayName}
          <input type="text" name="display_name" required placeholder={t.signup.displayNameHint} />
        </label>
        <label>
          {t.signup.email}
          <input type="email" name="email" autoComplete="email" placeholder={t.signup.emailHint} />
        </label>
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
