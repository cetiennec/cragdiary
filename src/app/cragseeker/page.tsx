import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getClimbedRouteIds, getEditableWishlists } from "@/lib/queries";
import Cragseeker, { type SeekerParams } from "@/components/Cragseeker";

export const metadata: Metadata = {
  title: "Cragseeker — Cragdiary",
  description:
    "Search the Camptocamp route database around a place or a pin on the map, by activity, grade and orientation.",
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
  // Logged-out visitors can search all they like; only saving needs a list.
  const wishlists = user ? await getEditableWishlists(user.id) : [];
  // Routes already in the journal, so the search can say "you've done this one".
  const climbed = user ? await getClimbedRouteIds(user.id) : [];

  // A shared link arrives as query params; the component takes it from there
  // and keeps the URL in step from the client.
  return (
    <Cragseeker
      t={t.seeker}
      locale={locale}
      // Distinct from "has no wishlist": a signed-in climber whose lists are
      // all read-only gets the same empty array, and must not be sent to the
      // signup page for it.
      signedIn={Boolean(user)}
      wishlists={wishlists}
      climbed={climbed}
      params={params}
    />
  );
}
