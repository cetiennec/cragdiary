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
          Password
          <input type="password" name="password" required autoFocus />
        </label>
        {error && <p className="form-error">Wrong password.</p>}
        <button type="submit" className="btn-primary">
          Log in
        </button>
      </form>
    </div>
  );
}
