import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getEditableWishlists } from "@/lib/queries";
import CragSeeker, { type SeekerParams } from "@/components/CragSeeker";

export const metadata: Metadata = {
  title: "CragSeeker — Cragdiary",
  description:
    "Search the Camptocamp route database around a place or a pin on the map, by activity, grade and orientation.",
};

export default async function CragSeekerPage({
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

  // A shared link arrives as query params; the component takes it from there
  // and keeps the URL in step from the client.
  return <CragSeeker t={t.seeker} locale={locale} wishlists={wishlists} params={params} />;
}
