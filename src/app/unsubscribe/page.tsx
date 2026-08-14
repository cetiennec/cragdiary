import Link from "next/link";
import { getDict } from "@/lib/i18n";
import { verifyUnsubscribe } from "@/lib/email-notifications";
import { confirmUnsubscribe } from "@/app/actions";

/**
 * The end of the link every email carries. It works signed out — the whole
 * point is that leaving must not require getting back in — and it asks before
 * it acts: mail clients and security scanners follow links in emails on their
 * own, and a GET that switched a setting off would be switched off by robots.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; k?: string; s?: string; done?: string }>;
}) {
  const [{ u, k, s, done }, { t }] = await Promise.all([searchParams, getDict()]);
  const tu = t.unsubscribe;

  if (done) {
    return (
      <div className="page-container narrow">
        <h1 className="page-title">{tu.doneTitle}</h1>
        <p>{tu.doneText}</p>
        <p className="form-hint">
          <Link href="/notifications">{tu.preferences}</Link>
        </p>
      </div>
    );
  }

  const valid = u && k && s && verifyUnsubscribe(u, k, s);
  if (!valid) {
    return (
      <div className="page-container narrow">
        <h1 className="page-title">{tu.badTitle}</h1>
        <p>{tu.badText}</p>
        <p className="form-hint">
          <Link href="/notifications">{tu.preferences}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page-container narrow">
      <h1 className="page-title">{tu.title}</h1>
      <p>{k === "digest" ? tu.whatDigest : tu.whatTags}</p>
      <form action={confirmUnsubscribe} className="entry-form">
        <input type="hidden" name="u" value={u} />
        <input type="hidden" name="k" value={k} />
        <input type="hidden" name="s" value={s} />
        <button type="submit" className="btn-primary">
          {tu.confirm}
        </button>
      </form>
      <p className="form-hint">{tu.rest}</p>
    </div>
  );
}
