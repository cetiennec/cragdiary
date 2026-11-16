import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getClimbedRouteIds, getEditableWishlists, getLoggedGrades } from "@/lib/queries";
import { usualLevels } from "@/lib/seeker/usual";
import Cragseeker, { type SeekerParams } from "@/components/Cragseeker";

// The route search. The first version of its menu stays at /cragseeker/classic;
// both read the same query string, so a link opens the same search in either.
export const metadata: Metadata = {
  title: "Cragseeker",
  description:
    "Find a route around a place: pick the kind of day, then narrow it by grade, aspect, length and altitude.",
};

export default async function CragseekerPage({
  searchParams,
}: {
  searchParams: Promise<SeekerParams>;
}) {
  const [user, { locale, t }, params] = await Promise.all([
    currentUser(),
    getDict(),
    searchParams,
  ]);
  const wishlists = user ? await getEditableWishlists(user.id) : [];
  const climbed = user ? await getClimbedRouteIds(user.id) : [];
  const usual = user ? usualLevels(await getLoggedGrades(user.id)) : {};

  return (
    <Cragseeker
      t={t.seeker}
      locale={locale}
      signedIn={Boolean(user)}
      wishlists={wishlists}
      climbed={climbed}
      usual={usual}
      params={params}
      variant="v2"
    />
  );
}
