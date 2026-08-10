import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getDict } from "@/lib/i18n";
import { getEditableWishlists } from "@/lib/queries";
import CragSeeker from "@/components/CragSeeker";

export const metadata: Metadata = {
  title: "Cragseeker — Cragdiary",
  description:
    "Search the Camptocamp route database around a place or a pin on the map, by activity, grade and orientation.",
};

export default async function CragSeekerPage() {
  const [user, { locale, t }] = await Promise.all([currentUser(), getDict()]);
  // Logged-out visitors can search all they like; only saving needs a list.
  const wishlists = user ? await getEditableWishlists(user.id) : [];

  return <CragSeeker t={t.seeker} locale={locale} wishlists={wishlists} />;
}
