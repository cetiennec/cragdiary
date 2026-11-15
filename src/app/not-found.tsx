import Link from "next/link";
import { getDict, titled } from "@/lib/i18n";

export const generateMetadata = titled((t) => t.notFound.title);

// A missing page, in the reader's language and inside the site, with the two
// ways on that make sense from nowhere — the feed, and the route search.
// Without this file the 404 was Next's bare English default.
export default async function NotFound() {
  const { t } = await getDict();
  return (
    <div className="page-container">
      <h1 className="page-title">{t.notFound.title}</h1>
      <p className="not-found-text">{t.notFound.text}</p>
      <p className="not-found-links">
        <Link href="/" className="btn-primary">
          {t.notFound.feed}
        </Link>
        <Link href="/cragseeker" className="filter-clear">
          {t.notFound.seeker}
        </Link>
      </p>
    </div>
  );
}
