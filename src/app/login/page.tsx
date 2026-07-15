import Link from "next/link";
import { login } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { t }] = await Promise.all([searchParams, getDict()]);

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.login.title}</h1>
      <form action={login} className="entry-form">
        <label>
          {t.login.username}
          <input type="text" name="username" required autoFocus autoComplete="username" />
        </label>
        <label>
          {t.login.password}
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        {error && <p className="form-error">{t.login.error}</p>}
        <button type="submit" className="btn-primary">
          {t.login.submit}
        </button>
        <p className="form-hint">
          {t.login.hintPre}
          <Link href="/signup">{t.login.hintLink}</Link>.
        </p>
      </form>
    </div>
  );
}
