import Link from "next/link";
import { login } from "@/app/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="page-container narrow">
      <h1 className="page-title">Log in</h1>
      <form action={login} className="entry-form">
        <label>
          Username
          <input type="text" name="username" required autoFocus autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        {error && <p className="form-error">Wrong username or password.</p>}
        <button type="submit" className="btn-primary">
          Log in
        </button>
        <p className="form-hint">
          No account yet? <Link href="/signup">Sign up</Link>.
        </p>
      </form>
    </div>
  );
}
