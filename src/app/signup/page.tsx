import Link from "next/link";
import { signup } from "@/app/actions";

const ERROR_MESSAGES: Record<string, string> = {
  username: "Username must be 3–20 characters: lowercase letters, digits, hyphens.",
  name: "Please enter a display name.",
  password: "Password must be at least 8 characters.",
  taken: "That username is already taken.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="page-container narrow">
      <h1 className="page-title">Start your journal</h1>
      <form action={signup} className="entry-form">
        <label>
          Username
          <input
            type="text"
            name="username"
            required
            autoFocus
            autoComplete="username"
            pattern="[a-z0-9-]{3,20}"
            placeholder="lowercase letters, digits, hyphens"
          />
        </label>
        <label>
          Display name
          <input type="text" name="display_name" required placeholder="How your name appears" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="form-error">{ERROR_MESSAGES[error] ?? "Something went wrong."}</p>}
        <button type="submit" className="btn-primary">
          Create account
        </button>
        <p className="form-hint">
          Already have one? <Link href="/login">Log in</Link>.
        </p>
      </form>
    </div>
  );
}
