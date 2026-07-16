import { resetPassword } from "@/app/actions";
import { getDict } from "@/lib/i18n";

export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, { error }, { t }] = await Promise.all([params, searchParams, getDict()]);

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{t.reset.title}</h1>
      <form action={resetPassword} className="entry-form">
        <input type="hidden" name="token" value={token} />
        <label>
          {t.reset.newPassword}
          <input type="password" name="password" required minLength={8} autoFocus autoComplete="new-password" />
        </label>
        {error === "password" && <p className="form-error">{t.signup.errors.password}</p>}
        {error === "invalid" && <p className="form-error">{t.reset.invalid}</p>}
        <button type="submit" className="btn-primary">
          {t.reset.confirm}
        </button>
      </form>
    </div>
  );
}
