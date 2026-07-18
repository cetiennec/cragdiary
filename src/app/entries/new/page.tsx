import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getWish } from "@/lib/queries";
import { getDict } from "@/lib/i18n";
import EntryForm, { type EntryDefaults } from "@/components/EntryForm";

export default async function NewEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ from_wish?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }

  const { from_wish } = await searchParams;
  let defaults: EntryDefaults | undefined;
  if (from_wish) {
    const wish = await getWish(from_wish, user.id);
    if (wish) {
      defaults = {
        crag: wish.title,
        location: wish.location ?? undefined,
        grade_max: wish.grade_max ?? undefined,
        rating: wish.rating ?? undefined,
        pitches: wish.pitches,
        height_m: wish.height_m,
        c2c_url: wish.c2c_url ?? undefined,
        lat: wish.lat,
        lon: wish.lon,
        partners: wish.partners ?? undefined,
        fromWish: wish.id,
      };
    }
  }

  const { locale, t } = await getDict();
  return <EntryForm t={t.editor} locale={locale} defaults={defaults} />;
}
