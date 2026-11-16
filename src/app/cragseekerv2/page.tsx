import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getClimbedRouteIds, getEditableWishlists } from "@/lib/queries";
import Cragseeker, { type SeekerParams } from "@/components/Cragseeker";

// The second Cragseeker menu, beside the first rather than instead of it: the
// same search, state and links, asked through a different panel. A link from
// one opens the same search in the other.
export const metadata: Metadata = {
  title: "Cragseeker v2",
  description:
    "Find a route around a place: pick the kind of day, then narrow it by grade, aspect, length and altitude.",
};

export default async function CragseekerV2Page({
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

  return (
    <Cragseeker
      t={t.seeker}
      locale={locale}
      signedIn={Boolean(user)}
      wishlists={wishlists}
      climbed={climbed}
      params={params}
      variant="v2"
    />
  );
}
