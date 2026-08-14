import Link from "next/link";
import { login } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [{ error, next }, { t }] = await Promise.all([searchParams, getDict()]);
  // Our own paths only — see `safeNext` in app/actions.ts, which refuses the
  // rest on the way back in.
  const back = next?.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.login.title}</h1>
      <form action={login} className="entry-form">
        {back && <input type="hidden" name="next" value={back} />}
        <label>
          {t.login.username}
          <input type="text" name="username" required autoFocus autoComplete="username" />
        </label>
        <label>
          {t.login.password}
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        {error && (
          <p className="form-error">
            {error === "throttled" ? t.login.throttled : t.login.error}
          </p>
        )}
        <button type="submit" className="btn-primary">
          {t.login.submit}
        </button>
        <p className="form-hint">
          {t.login.hintPre}
          <Link href={back ? `/signup?next=${encodeURIComponent(back)}` : "/signup"}>
            {t.login.hintLink}
          </Link>
          .{" "}
          <Link href="/forgot">{t.login.forgot}</Link>
        </p>
      </form>
    </div>
  );
}
