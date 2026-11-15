import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getDict, titled } from "@/lib/i18n";
import { getDaysWith, getUserByUsername } from "@/lib/queries";
import EntryCard from "@/components/EntryCard";

// The days two climbers spent together: one page per rope partner, reached
// from the climbers list. A day counts when either of them wrote it up naming
// the other — so it works even when only one of you keeps a journal.
export const generateMetadata = titled((t) => t.cordees.title);

export default async function DaysWithPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const [other, { locale, t }] = await Promise.all([getUserByUsername(username), getDict()]);
  // A by-link journal still shares its days with the people who were there
  // (migration 037) — what each day shows is settled on the day itself.
  if (!other || other.id === user.id) notFound();

  const days = await getDaysWith(user.id, user.username, other.username);

  return (
    <div className="page-container">
      <h1 className="page-title">
        {t.cordees.title} <Link href={`/u/${other.username}`}>{other.display_name}</Link>
      </h1>
      <p className="form-hint days-with-count">
        {days.length === 0 ? t.cordees.empty : t.cordees.count(days.length)}
      </p>

      {/* One grid, like the feed: the days flow across the page instead of
          stacking one block per date. Each card carries its own date and
          author, so whose version it is stays plain. */}
      <div className="entry-grid">
        {days.flatMap((day) =>
          [day.mine, day.theirs]
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
            .map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                locale={locale}
                demoLabel={t.demo.banner}
              />
            ))
        )}
      </div>
    </div>
  );
}
